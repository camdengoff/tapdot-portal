// Every /api/ request goes to the portal API (see server/api.js).
import { handle } from '../../server/api.js';

export const onRequest = (ctx) => handle(ctx);
