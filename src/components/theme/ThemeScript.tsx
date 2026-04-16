// Inlined into <head> so the correct theme class is on <html>
// before the first paint — no flash.
export function ThemeScript() {
  const code = `
(function() {
  try {
    var stored = localStorage.getItem('pulse-theme');
    var theme = stored === 'light' || stored === 'dark' ? stored : 'dark';
    var root = document.documentElement;
    if (theme === 'dark') root.classList.add('dark');
    else root.classList.remove('dark');
  } catch (e) {}
})();
`;
  return <script dangerouslySetInnerHTML={{ __html: code }} />;
}
