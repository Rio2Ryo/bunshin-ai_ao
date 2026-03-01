// IndexedDB helper for offline chat cache + message queue

const DB_NAME = 'bunshin-ai-offline';
const DB_VERSION = 1;

export interface ChatMessage {
  sessionId: number;
  role: string;
  content: string;
  createdAt?: string;
}

export interface ChatSession {
  id: number;
  title?: string | null;
  messageCount?: number;
}

export interface QueuedMessage {
  id: number;
  sessionId: number;
  content: string;
  createdAt: string;
  status: 'pending' | 'sending';
}

export function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains('chatMessages')) {
        const msgStore = db.createObjectStore('chatMessages', { keyPath: ['sessionId', 'index'] });
        msgStore.createIndex('sessionId', 'sessionId', { unique: false });
      }

      if (!db.objectStoreNames.contains('chatSessions')) {
        db.createObjectStore('chatSessions', { keyPath: 'id' });
      }

      if (!db.objectStoreNames.contains('messageQueue')) {
        db.createObjectStore('messageQueue', { keyPath: 'id', autoIncrement: true });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveChatMessages(sessionId: number, messages: ChatMessage[]): Promise<void> {
  const db = await openDB();
  const tx = db.transaction('chatMessages', 'readwrite');
  const store = tx.objectStore('chatMessages');

  // Clear existing messages for this session
  const index = store.index('sessionId');
  const range = IDBKeyRange.only(sessionId);
  const cursorReq = index.openCursor(range);

  await new Promise<void>((resolve, reject) => {
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      } else {
        resolve();
      }
    };
    cursorReq.onerror = () => reject(cursorReq.error);
  });

  // Add new messages
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    store.put({
      sessionId: msg.sessionId ?? sessionId,
      index: i,
      role: msg.role,
      content: msg.content,
      createdAt: msg.createdAt,
    });
  }

  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  db.close();
}

export async function getChatMessages(sessionId: number): Promise<ChatMessage[]> {
  const db = await openDB();
  const tx = db.transaction('chatMessages', 'readonly');
  const store = tx.objectStore('chatMessages');
  const index = store.index('sessionId');
  const range = IDBKeyRange.only(sessionId);

  return new Promise((resolve, reject) => {
    const request = index.getAll(range);
    request.onsuccess = () => {
      const results = (request.result || [])
        .sort((a: any, b: any) => a.index - b.index)
        .map((r: any) => ({
          sessionId: r.sessionId,
          role: r.role,
          content: r.content,
          createdAt: r.createdAt,
        }));
      db.close();
      resolve(results);
    };
    request.onerror = () => {
      db.close();
      reject(request.error);
    };
  });
}

export async function saveChatSessions(sessions: ChatSession[]): Promise<void> {
  const db = await openDB();
  const tx = db.transaction('chatSessions', 'readwrite');
  const store = tx.objectStore('chatSessions');

  store.clear();
  for (const session of sessions) {
    store.put({
      id: session.id,
      title: session.title,
      messageCount: session.messageCount,
    });
  }

  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  db.close();
}

export async function getChatSessions(): Promise<ChatSession[]> {
  const db = await openDB();
  const tx = db.transaction('chatSessions', 'readonly');
  const store = tx.objectStore('chatSessions');

  return new Promise((resolve, reject) => {
    const request = store.getAll();
    request.onsuccess = () => {
      db.close();
      resolve(request.result || []);
    };
    request.onerror = () => {
      db.close();
      reject(request.error);
    };
  });
}

export async function enqueueMessage(sessionId: number, content: string): Promise<number> {
  const db = await openDB();
  const tx = db.transaction('messageQueue', 'readwrite');
  const store = tx.objectStore('messageQueue');

  return new Promise((resolve, reject) => {
    const request = store.add({
      sessionId,
      content,
      createdAt: new Date().toISOString(),
      status: 'pending' as const,
    });
    request.onsuccess = () => {
      db.close();
      resolve(request.result as number);
    };
    request.onerror = () => {
      db.close();
      reject(request.error);
    };
  });
}

export async function dequeueMessage(id: number): Promise<void> {
  const db = await openDB();
  const tx = db.transaction('messageQueue', 'readwrite');
  const store = tx.objectStore('messageQueue');

  return new Promise((resolve, reject) => {
    const request = store.delete(id);
    request.onsuccess = () => {
      db.close();
      resolve();
    };
    request.onerror = () => {
      db.close();
      reject(request.error);
    };
  });
}

export async function getPendingMessages(): Promise<QueuedMessage[]> {
  const db = await openDB();
  const tx = db.transaction('messageQueue', 'readonly');
  const store = tx.objectStore('messageQueue');

  return new Promise((resolve, reject) => {
    const request = store.getAll();
    request.onsuccess = () => {
      db.close();
      resolve(request.result || []);
    };
    request.onerror = () => {
      db.close();
      reject(request.error);
    };
  });
}

export async function clearMessageQueue(): Promise<void> {
  const db = await openDB();
  const tx = db.transaction('messageQueue', 'readwrite');
  const store = tx.objectStore('messageQueue');

  return new Promise((resolve, reject) => {
    const request = store.clear();
    request.onsuccess = () => {
      db.close();
      resolve();
    };
    request.onerror = () => {
      db.close();
      reject(request.error);
    };
  });
}
