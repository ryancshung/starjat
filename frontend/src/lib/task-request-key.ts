// Keep the same request ID after a lost response, including after a page reload.
// In privacy modes where storage is unavailable, retain it for this page session.
const fallback=new Map<string,string>();
export function taskRequestId(key:string) {
  let id=fallback.get(key);
  try { id=sessionStorage.getItem(key)??id; } catch { /* Storage may be unavailable. */ }
  if(!id)id=crypto.randomUUID();
  fallback.set(key,id);
  try { sessionStorage.setItem(key,id); } catch { /* The in-memory ID remains usable. */ }
  return id;
}
export function clearTaskRequestId(key:string) {
  fallback.delete(key);
  try { sessionStorage.removeItem(key); } catch { /* No persistent storage. */ }
}
