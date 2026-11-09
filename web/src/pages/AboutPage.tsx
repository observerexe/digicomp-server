import { Card, PageHeader } from '../components/ui';
import { ThemeSwitch } from './MorePage';

export function AboutPage() {
  return (
    <>
      <PageHeader title="Про застосунок" />
      <div style={{ display: 'grid', gap: 12, maxWidth: 720 }}>
        <Card>
          <p style={{ margin: 0 }}>
            DigiComp HUB — застосунок творчої групи DigiComp: команда, обладнання, ТЗ, бали, проєкти, склад і архів.
          </p>
          <p className="hint">
            Вихідний код:{' '}
            <a href="https://github.com/observerexe/digicomp-server" rel="noopener noreferrer">
              github.com/observerexe/digicomp-server
            </a>{' '}
            (GNU AGPL v3).
          </p>
        </Card>
        <Card>
          <ThemeSwitch />
        </Card>
        <Card>
          <p className="hint" style={{ margin: 0 }}>
            Гарнітура e-Ukraine © Міністерство цифрової трансформації України, ліцензія{' '}
            <a href="https://creativecommons.org/licenses/by/4.0/deed.uk" rel="noopener noreferrer">
              CC BY 4.0
            </a>
            . Джерело:{' '}
            <a href="https://thedigital.gov.ua/fonts" rel="noopener noreferrer">
              thedigital.gov.ua/fonts
            </a>
            .
          </p>
        </Card>
      </div>
    </>
  );
}
