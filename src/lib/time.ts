/** Request-time clock for Server Components (kept out of component bodies for the React purity lint). */
export const nowMs = () => Date.now();
