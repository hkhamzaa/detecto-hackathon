import { parse } from 'cookie';

/**
 * Populates `req.cookies` from the raw `Cookie` header. Express's `res.cookie()`
 * (used to set the refresh cookie) needs no help — this is only for reading
 * one back on the way in, e.g. `req.cookies[config.refreshCookie.name]`.
 */
export function parseCookies(req, _res, next) {
  req.cookies = req.headers.cookie ? parse(req.headers.cookie) : {};
  next();
}
