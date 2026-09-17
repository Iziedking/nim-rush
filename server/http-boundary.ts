import express, { type Express } from 'express';

import { corsDecision } from './cors';
import { apiSecurityHeaders } from './security-headers';

export interface HttpBoundaryOptions {
  allowedOrigins: readonly string[];
  production: boolean;
  trustProxy: boolean;
  networkHeader: string;
}

/*
 * Headroom over the largest real trace. London is the longest city at about
 * 129kb of frames; 320kb leaves room for a longer course without becoming a
 * useful amount of memory to throw at the service.
 */
const TRACE_BODY_LIMIT = '320kb';

export function allowedRequestHeaders(networkHeader: string): string {
  return `content-type, authorization, ${networkHeader}`;
}

export function installHttpBoundary(app: Express, options: HttpBoundaryOptions): void {
  if (options.trustProxy) app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    for (const [name, value] of Object.entries(apiSecurityHeaders())) res.setHeader(name, value);
    next();
  });
  /*
   * Cross-origin headers before the body is read.
   *
   * These used to be set after the JSON parser, so a request the parser
   * rejected - anything over the limit, or malformed - was answered without
   * them. The browser cannot see a response it is not allowed to read, so a
   * clean 413 reached the client as a network failure and the app said the
   * service was unreachable. It looked like the server was down; it was
   * refusing a payload and saying so where nobody could hear it.
   */
  app.use((req, res, next) => {
    const cors = corsDecision(req.headers.origin, options.allowedOrigins, options.production);
    if (!cors.allowed) {
      res.status(403).json({ error: 'Origin is not allowed.' });
      return;
    }
    if (cors.header) {
      res.setHeader('access-control-allow-origin', cors.header);
      if (cors.header !== '*') res.setHeader('vary', 'Origin');
    }
    res.setHeader('access-control-allow-methods', 'GET,POST,PATCH,OPTIONS');
    res.setHeader('access-control-allow-headers', allowedRequestHeaders(options.networkHeader));
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });

  /*
   * A verified run is a whole input trace, and a trace does not fit in 16kb.
   *
   * Ranked mode re-simulates the run from every frame the rider actually
   * pressed, which for a ninety-second descent is around 2,000 frames and
   * about 120kb of JSON - eight times the general limit. So every ranked
   * submission this service has ever been sent was refused before it reached a
   * route, on every device, and the board stayed empty for a reason that had
   * nothing to do with the game.
   *
   * The general limit stays where it is, because it is right for every other
   * endpoint and a smaller ceiling is a cheaper defence than a larger one. Only
   * the two routes that carry a trace are widened, and only to the size a real
   * trace needs plus headroom for the longest city.
   */
  app.use(['/atlas/api/blitz/runs', '/atlas/api/competitive/runs'], express.json({ limit: TRACE_BODY_LIMIT }));
  app.use(express.json({ limit: '16kb' }));
}
