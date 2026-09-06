// All IndexedDB access is centralized here. UI success is reported only after oncomplete.
const DB_NAME = 'courtside-log';
const DB_VERSION = 1;
const STORES = ['teams', 'games', 'events', 'settings'];
let connection;
let epoch = 0;
export class ConflictError extends Error {
  constructor() { super('別の画面でデータが更新されました。最新の記録を読み込みました。操作をやり直してください。'); this.name = 'ConflictError'; }
}
export async function openDB() {
  if (connection) return connection;
  connection = await new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore('teams', { keyPath: 'id' });
      db.createObjectStore('games', { keyPath: 'id' });
      db.createObjectStore('events', { keyPath: 'id' }).createIndex('gameId', 'gameId');
      db.createObjectStore('settings', { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('ほかのCourtsideの画面を閉じて、再読み込みしてください。'));
  });
  connection.onversionchange = () => { connection.close(); connection = null; };
  return connection;
}
async function transact(names, mode, run) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    let tx;
    try { tx = db.transaction(names, mode, { durability: 'strict' }); }
    catch { tx = db.transaction(names, mode); }
    let result, failure;
    tx.oncomplete = () => resolve(result);
    tx.onabort = () => reject(failure || tx.error || new Error('保存できませんでした。'));
    tx.onerror = () => {};
    const setResult = v => { result = v; };
    const fail = error => { failure = error; tx.abort(); };
    try { run(tx, setResult, fail); } catch (error) { fail(error); }
  });
}
function checkedWrite(names, run) {
  return transact([...new Set([...names, 'settings'])], 'readwrite', (tx, result, fail) => {
    const request = tx.objectStore('settings').get('_epoch');
    request.onsuccess = () => {
      if ((request.result?.value || 0) !== epoch) return fail(new ConflictError());
      try { run(tx, result, fail); } catch (error) { fail(error); }
    };
  });
}
export async function readAll() {
  const snapshot = await transact(STORES, 'readonly', (tx, done) => {
    const data = {};
    for (const name of STORES) { const r = tx.objectStore(name).getAll(); r.onsuccess = () => { data[name] = r.result; }; }
    done(data);
  });
  epoch = snapshot.settings.find(s => s.key === '_epoch')?.value || 0;
  return snapshot;
}
export function saveSetting(key, value) { return checkedWrite([], tx => tx.objectStore('settings').put({ key, value })); }
export function saveTeam(team, expectedRevision = null) {
  return checkedWrite(['teams'], (tx, result, fail) => {
    const store = tx.objectStore('teams');
    const request = store.get(team.id);
    request.onsuccess = () => {
      try {
        if ((request.result?.revision ?? null) !== expectedRevision) return fail(new ConflictError());
        store.put(team); tx.objectStore('settings').delete('teamDraft'); result(team);
      } catch (error) { fail(error); }
    };
  });
}
export function createGame(game) {
  return checkedWrite(['games'], (tx, result) => {
    tx.objectStore('games').add(game);
    tx.objectStore('settings').delete('gameDraft'); result(game);
  });
}
export function commitGame(game, event = null) {
  return checkedWrite(['games', 'events'], (tx, result, fail) => {
    const store = tx.objectStore('games');
    const request = store.get(game.id);
    request.onsuccess = () => {
      try {
        if (!request.result || request.result.revision !== game.revision) return fail(new ConflictError());
        const saved = { ...game, revision: game.revision + 1, updatedAt: new Date().toISOString() };
        store.put(saved);
        if (event) tx.objectStore('events').put(event);
        result(saved);
      } catch (error) { fail(error); }
    };
  });
}
export function addPlayerToTeamAndGame(team, game, player) {
  return checkedWrite(['teams', 'games'], (tx, result, fail) => {
    const teams = tx.objectStore('teams');
    const games = tx.objectStore('games');
    const teamRequest = teams.get(team.id);
    const gameRequest = games.get(game.id);
    let storedTeam, storedGame, remaining = 2;
    const save = () => {
      if (--remaining) return;
      try {
        if (!storedTeam || storedTeam.revision !== team.revision || !storedGame || storedGame.revision !== game.revision) return fail(new ConflictError());
        const exists = team.players.some(candidate => candidate.id === player.id);
        const savedTeam = {
          ...team,
          players: exists ? team.players.map(candidate => candidate.id === player.id ? player : candidate) : [...team.players, player],
          revision: team.revision + 1,
        };
        const savedGame = {
          ...game,
          roster: [...game.roster, structuredClone(player)],
          revision: game.revision + 1,
          updatedAt: new Date().toISOString(),
        };
        teams.put(savedTeam); games.put(savedGame); result({ team: savedTeam, game: savedGame });
      } catch (error) { fail(error); }
    };
    teamRequest.onsuccess = () => { storedTeam = teamRequest.result; save(); };
    gameRequest.onsuccess = () => { storedGame = gameRequest.result; save(); };
  });
}
export function deleteGame(game) {
  return checkedWrite(['games', 'events'], (tx, result, fail) => {
    const games = tx.objectStore('games');
    const request = games.get(game.id);
    request.onsuccess = () => {
      try {
        if (!request.result || request.result.revision !== game.revision) return fail(new ConflictError());
        const events = tx.objectStore('events');
        const cursorRequest = events.index('gameId').openCursor(IDBKeyRange.only(game.id));
        cursorRequest.onsuccess = () => {
          try {
            const cursor = cursorRequest.result;
            if (cursor) { cursor.delete(); cursor.continue(); return; }
            games.delete(game.id); result(game.id);
          } catch (error) { fail(error); }
        };
      } catch (error) { fail(error); }
    };
  });
}
export async function replaceAll(data) {
  const newEpoch = crypto.randomUUID();
  await checkedWrite(STORES, tx => {
    for (const name of STORES) {
      const store = tx.objectStore(name); store.clear();
      for (const item of data[name]) store.add(item);
    }
    tx.objectStore('settings').put({ key: '_epoch', value: newEpoch });
  });
  epoch = newEpoch;
}
