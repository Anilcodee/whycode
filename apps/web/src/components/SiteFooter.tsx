import { Brand } from './Brand';

type Props = {
  onHome: () => void;
  onHelp: () => void;
  onRepositories: () => void;
  serviceReady?: boolean;
  privateMode: boolean;
};

const technologies = [
  { name: 'Sarvam', url: 'https://www.sarvam.ai/', purpose: 'Indian-language output' },
  { name: 'Neo4j Aura', url: 'https://neo4j.com/cloud/aura/', purpose: 'Connected evidence graph' },
  { name: 'Google Gemini', url: 'https://ai.google.dev/', purpose: 'Answer generation' },
  { name: 'GitHub API', url: 'https://docs.github.com/en/rest', purpose: 'Repository history & sources' },
];

export function SiteFooter({ onHome, onHelp, onRepositories, serviceReady, privateMode }: Props) {
  return (
    <footer className="site-footer">
      <div className="footer-main">
        <div className="footer-identity">
          <Brand onHome={onHome} />
          <p>Understand the code.<br />Find the story behind it.</p>
        </div>
        <div className="footer-links">
          <span>EXPLORE</span>
          <button onClick={onHome}>Start an investigation ↗</button>
          <button onClick={onHelp}>How WhyCode works ↗</button>
          <button onClick={onRepositories}>Repositories &amp; history ↗</button>
        </div>
        <div className="footer-note footer-technology">
          <span>BUILT WITH</span>
          <dl>
            {technologies.map(({ name, url, purpose }) => (
              <div key={name}>
                <dt><a href={url} target="_blank" rel="noopener noreferrer">{name} ↗</a></dt>
                <dd>{purpose}</dd>
              </div>
            ))}
          </dl>
          <span className={`service-status ${serviceReady ? 'online' : ''}`}>
            <span />{serviceReady ? 'Sources connected' : 'Checking sources'}
          </span>
        </div>
      </div>
      <div className="footer-bottom">
        <span>© {new Date().getFullYear()} WhyCode</span>
        <span>{privateMode ? 'Private sources stay in this session.' : 'Read-only exploration. Your code stays yours.'}</span>
        <a href="#main">Back to top ↑</a>
      </div>
    </footer>
  );
}
