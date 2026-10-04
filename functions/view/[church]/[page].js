// A published page as a standalone web page, for QR codes and tap tags that skip the website.
import { live } from '../../../server/api.js';

export const onRequestGet = (ctx) => live(ctx, true);
