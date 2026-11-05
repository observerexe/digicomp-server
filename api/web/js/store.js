// Просте сховище стану застосунку.
const listeners = new Set();
export const state = { me: null, activeSession: null, publicOrigin: null };
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function update(patch) { Object.assign(state, patch); listeners.forEach((fn) => fn(state)); }
export const role = () => state.me?.role;
export const isSupervisor = () => role() === 'admin' || role() === 'coordinator';
export const isAdmin = () => role() === 'admin';
