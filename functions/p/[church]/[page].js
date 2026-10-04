// A published page's HTML, loaded by the code block on the church's site (see embed.js).
import { live } from '../../../server/api.js';

export const onRequestGet = (ctx) => live(ctx, false);
