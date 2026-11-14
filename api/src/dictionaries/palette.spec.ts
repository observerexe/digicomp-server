import { readFileSync } from 'fs';
import { join } from 'path';
import { PALETTE } from './palette';

type Shade = { solid: string; soft: string; text: string };

describe('Палітра довідників', () => {
  it('назви збігаються з docs/design/tokens.json', () => {
    const tokens = JSON.parse(
      readFileSync(
        join(__dirname, '..', '..', '..', 'docs', 'design', 'tokens.json'),
        'utf8',
      ),
    ) as { palette: Record<string, Shade | string> };
    const names = Object.keys(tokens.palette).filter((k) => !k.startsWith('$'));
    expect(names).toEqual([...PALETTE]);
  });
});
