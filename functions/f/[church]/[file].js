// A photo or PDF uploaded for a page's full-screen viewer (see server/files.js).
import { serve } from '../../../server/files.js';

export const onRequestGet = (ctx) => serve(ctx.env, ctx.params);
