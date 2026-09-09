export const esc = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const icon = (name, className = '') => `<svg class="ui-icon ${className}" aria-hidden="true"><use href="assets/icons.svg#${name}"></use></svg>`;
export const DESKTOPS = [
  {id:'plasma', name:'Plasma', package:'plasma-desktop', caption:'Ett skrivbord som känns som hemma.', detail:'Flytande panel · flexibla fönster', color:'#94dfc5'},
  {id:'gnome', name:'GNOME', package:'gnome-shell', caption:'Lugn, rymlig och fokuserad.', detail:'Toppanel · programöversikt', color:'#a6bafa'},
  {id:'xfce', name:'XFCE', package:'xfce4', caption:'Det klassiska, kompakta skrivbordet.', detail:'Kompakt panel · raka hörn', color:'#edc784'},
  {id:'i3', name:'i3', package:'i3-wm', caption:'En plats för varje fönster.', detail:'Automatisk plattsättning · tangentbord', color:'#bcd884'},
  {id:'openbox', name:'Openbox', package:'openbox', caption:'Bara det du behöver.', detail:'Minimal panel · högerklicksmeny', color:'#eeaf96'},
];
export const WALLPAPERS = [
  {id:'glimten', name:'Glimten', caption:'En solig tanke'},
  {id:'midnatt', name:'Midnatt', caption:'När världen blir stilla'},
  {id:'gryning', name:'Gryning', caption:'En ny början'},
  {id:'terminal', name:'Terminal', caption:'Plats för idéer'},
];
export function download(name, content, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([content], {type}));
  const a = document.createElement('a'); a.href=url; a.download=name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function exportVirtualFile(name, content) {
  const wallpaper = content.startsWith('flinux-wallpaper:') ? content.slice('flinux-wallpaper:'.length) : null;
  if (WALLPAPERS.some(item => item.id === wallpaper) || /^data:image\/(png|jpeg|webp);base64,/.test(content)) {
    const link = document.createElement('a');
    link.href = wallpaper ? `assets/wallpapers/${wallpaper}.svg` : content;
    link.download = name; link.click();
  } else download(name, content);
}
export function safeAction(action, toast) { try { return action(); } catch (error) { toast(error.message); } }
