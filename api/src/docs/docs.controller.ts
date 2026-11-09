import {
  Controller,
  Get,
  Injectable,
  NotFoundException,
  Param,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { ApiExcludeController, OpenAPIObject } from '@nestjs/swagger';
import type { Response } from 'express';
import { createReadStream } from 'fs';
import { dirname, join } from 'path';
import { Action } from '../auth/policy';
import { Can, JwtAuthGuard, PolicyGuard } from '../auth/roles';
import { CSP } from '../common/web';

/** Holds the OpenAPI document built in setupApp (needs the whole app). */
@Injectable()
export class DocsService {
  document: OpenAPIObject | null = null;
}

const UI_DIR = dirname(require.resolve('swagger-ui-dist/package.json'));

const ASSETS: Record<string, string> = {
  'swagger-ui.css': 'text/css; charset=utf-8',
  'swagger-ui-bundle.js': 'text/javascript; charset=utf-8',
  'swagger-ui-standalone-preset.js': 'text/javascript; charset=utf-8',
};

// Inline <script> is forbidden by CSP, so the initializer is a separate file.
// X-DC-Client lets "Try it out" pass the CSRF check with cookie auth.
const INIT_JS = `window.addEventListener('load', function () {
  window.ui = SwaggerUIBundle({
    url: '/api/docs/openapi.json',
    dom_id: '#swagger-ui',
    presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
    layout: 'StandaloneLayout',
    withCredentials: true,
    requestInterceptor: function (req) {
      req.headers['X-DC-Client'] = 'web';
      return req;
    },
  });
});
`;

const HTML = `<!DOCTYPE html>
<html lang="uk">
<head>
<meta charset="utf-8">
<title>DigiComp HUB API</title>
<link rel="stylesheet" href="/api/docs/assets/swagger-ui.css">
</head>
<body>
<div id="swagger-ui"></div>
<script src="/api/docs/assets/swagger-ui-bundle.js"></script>
<script src="/api/docs/assets/swagger-ui-standalone-preset.js"></script>
<script src="/api/docs/assets/init.js"></script>
</body>
</html>
`;

// Swagger UI sets inline style attributes; allow them on /docs only.
const DOCS_CSP = CSP.replace(
  "style-src 'self'",
  "style-src 'self' 'unsafe-inline'",
);

@ApiExcludeController()
@Controller('docs')
@UseGuards(JwtAuthGuard, PolicyGuard)
@Can(Action.ApiDocs)
export class DocsController {
  constructor(private docs: DocsService) {}

  @Get()
  page(@Res({ passthrough: true }) res: Response) {
    res.set({
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': DOCS_CSP,
    });
    return HTML;
  }

  @Get('openapi.json')
  spec() {
    if (!this.docs.document) throw new NotFoundException('Document not found');
    return this.docs.document;
  }

  @Get('assets/:file')
  asset(
    @Param('file') file: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (file === 'init.js') {
      res.set('Content-Type', 'text/javascript; charset=utf-8');
      return INIT_JS;
    }
    const type = Object.hasOwn(ASSETS, file) ? ASSETS[file] : undefined;
    if (!type) throw new NotFoundException('File not found');
    res.set('Content-Type', type);
    return new StreamableFile(createReadStream(join(UI_DIR, file)));
  }
}
