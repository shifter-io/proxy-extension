import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@/styles/globals.css';
import { loadLanguage } from '@/lib/i18n';
import { App } from '@/ui/App';

// The language is known before the first paint, so English never flashes.
void loadLanguage().then((code) => {
  document.documentElement.lang = code;
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
