// Interface language. Spanish covers the interface — title screen, HUD,
// touch buttons, menus, Settings, the controls help and the mode screens —
// by swapping exact strings as they appear on screen. The story, dialogue,
// letters and Journal entries stay in English (they're written in English;
// a real translation of them is a writing job, not a find-and-replace).
import { G } from './game/state.js';

/** English → Spanish, exact on-screen strings (trimmed). */
const ES = {
  // Title
  'A survival story': 'Una historia de supervivencia',
  '“You left the family. The family didn’t leave you.”': '«Dejaste a la familia. La familia no te dejó a ti.»',
  'Continue': 'Continuar', 'New Game': 'Nueva partida', 'Endless Siege': 'Asedio sin fin', 'The Long Night': 'La Noche Larga',
  'Ten waves to dawn · pick a boon after each': 'Diez oleadas hasta el amanecer · una mejora tras cada una',
  'Newark, 1999': 'Newark, 1999', 'Atlantic City, 1994': 'Atlantic City, 1994', '☁ Cloud Save': '☁ Guardado en la nube', 'Trophies': 'Trofeos', 'Import Save': 'Importar partida', 'Controls': 'Controles',
  'Quit to Desktop': 'Salir al escritorio',
  'Keep your level, skills and gear · tougher family': 'Conserva tu nivel, habilidades y equipo · una familia más dura',
  'Best in landscape on phones. Sound starts when you tap a button.': 'En el móvil, mejor en horizontal. El sonido empieza al tocar un botón.',
  '↻ Rotate your phone to landscape for the best experience': '↻ Gira el móvil a horizontal para jugar mejor', '(tap to dismiss)': '(toca para cerrar)',
  // HUD and touch
  'STAMINA': 'AGUANTE', 'MOVE': 'MOVER', 'AIM': 'APUNTAR', 'FIRE': 'DISPARAR', 'ACT': 'ACCIÓN', 'RELOAD': 'RECARGAR', 'MELEE': 'GOLPE',
  'DODGE': 'ESQUIVAR', 'USE': 'USAR', 'SWAP': 'CAMBIAR', 'SKILL': 'HABILIDAD', 'ORDERS': 'ÓRDENES', '🛡 IN COVER': '🛡 A CUBIERTO',
  'Tap / Space to continue': 'Toca / Espacio para seguir', 'Skip ⏭': 'Saltar ⏭', 'continue': 'seguir', 'skip': 'saltar',
  'HIDDEN': 'OCULTO', 'SEEN': 'VISTO',
  // Pause menu
  'PAUSED': 'PAUSA', 'Items': 'Objetos', 'Character': 'Personaje', 'Skills (JP)': 'Habilidades (PH)', 'Home': 'Casa', 'Map': 'Mapa',
  'Journal': 'Diario', 'Settings': 'Ajustes',
  'Story': 'Historia', 'Cases': 'Casos', 'Side stories': 'Historias secundarias', 'People': 'Gente', 'Calendar': 'Calendario', 'Scrapbook': 'Álbum', 'Log': 'Registro',
  // Settings
  'Language': 'Idioma', 'Sound volume': 'Volumen de efectos', 'Music volume': 'Volumen de música',
  'Aim assist (nudges aim toward nearby attackers)': 'Ayuda al apuntar (acerca la mira a los atacantes cercanos)',
  'Fire while pushing the aim stick (touch)': 'Disparar al empujar el stick de apuntar (táctil)',
  'Sprint at full stick tilt (controller)': 'Correr con el stick al máximo (mando)',
  'Sprint at full stick tilt (touch & controller)': 'Correr con el stick al máximo (táctil y mando)',
  'Show damage numbers': 'Mostrar números de daño', 'Screen shake': 'Vibración de pantalla', 'Full': 'Completa', 'Reduced': 'Reducida', 'Off': 'Desactivada',
  'Touch controls': 'Controles táctiles', 'Automatic': 'Automático', 'Always on': 'Siempre activos', 'Touch button opacity': 'Opacidad de los botones',
  'Touch button size': 'Tamaño de los botones', 'Smaller': 'Más pequeños', 'Normal': 'Normal', 'Larger': 'Más grandes', 'Text size': 'Tamaño del texto', 'Large': 'Grande',
  'Frame rate': 'Fotogramas', 'Smooth (60 fps)': 'Fluido (60 fps)', 'Battery saver (30 fps)': 'Ahorro de batería (30 fps)', 'Controller rumble': 'Vibración del mando',
  'Graphics': 'Gráficos', 'High': 'Altos', 'Low (saves battery)': 'Bajos (ahorra batería)', 'Low (older phones)': 'Bajos (móviles antiguos)', 'Difficulty': 'Dificultad',
  'Accessibility': 'Accesibilidad', 'Sound captions (what you hear, and from which way)': 'Subtítulos de sonido (qué oyes y desde dónde)',
  'Reduce flashes (softer muzzle and hit flashes, no red pulse in attacks)': 'Reducir destellos (fogonazos e impactos más suaves, sin pulso rojo en los ataques)',
  'High-contrast attackers (bright outline)': 'Atacantes de alto contraste (contorno brillante)', 'Game speed': 'Velocidad del juego',
  'Slower (80%)': 'Más lenta (80%)', 'Slowest (65%)': 'La más lenta (65%)',
  'Cloud save': 'Guardado en la nube', 'Save': 'Guardar', '☁ Cloud save…': '☁ Guardado en la nube…', 'Save now': 'Guardar ahora',
  'Export save file': 'Exportar partida', 'Import save file': 'Importar partida', 'Controls & Help': 'Controles y ayuda', 'Fullscreen on/off': 'Pantalla completa',
  'Quit to title': 'Volver al título', 'Quit to desktop': 'Salir al escritorio', 'Resume': 'Continuar',
  // Common buttons and pickers
  'Close': 'Cerrar', 'Back': 'Atrás', 'Done': 'Hecho', 'Cancel': 'Cancelar', 'OK': 'Aceptar', 'Not now': 'Ahora no', 'Accept': 'Aceptar', 'Leave': 'Irse',
  'Try again': 'Reintentar', 'Title screen': 'Pantalla de título', 'Keep playing': 'Seguir jugando', 'Continue playing': 'Seguir jugando', 'Begin': 'Empezar',
  'Choose your difficulty': 'Elige la dificultad', 'Hard': 'Difícil',
  'Attackers hit softer and fall faster, raids are rarer, defeat costs little. For the story.': 'Los atacantes pegan menos y caen antes, hay menos asaltos y perder cuesta poco. Para disfrutar la historia.',
  'The intended experience: every night matters.': 'La experiencia prevista: cada noche importa.',
  'Tougher attackers who hit harder, more frequent raids, costly defeats.': 'Atacantes más duros que pegan más fuerte, asaltos más frecuentes, derrotas caras.',
  'You can change this any time in Settings.': 'Puedes cambiarlo cuando quieras en Ajustes.', 'Are you sure?': '¿Seguro?',
  // Modes
  '🌙 The Long Night': '🌙 La Noche Larga', 'Start a run': 'Empezar una noche', "Play tonight's": 'Jugar la de hoy', 'Embers': 'Brasas', 'embers': 'brasas',
  'best night': 'mejor noche', 'dawns': 'amaneceres', 'Another night': 'Otra noche', '🌅 DAWN': '🌅 AMANECE', 'The night won — this time': 'La noche ganó — esta vez',
  'waves': 'oleadas', 'attackers down': 'atacantes abatidos', 'waves survived': 'oleadas resistidas', 'Choose one:': 'Elige una:',
  '⚔ Endless Siege': '⚔ Asedio sin fin', 'Free play': 'Juego libre', "Play today's challenge": 'Jugar el reto de hoy',
  // Defense Plan and Scrapbook
  '🗺 Defense Plan': '🗺 Plan de defensa', 'Fallback point': 'Punto de repliegue', 'Pick up': 'Recoger', '📷 Take a photo': '📷 Hacer una foto', 'Remove': 'Quitar',
  'No photos yet.': 'Aún no hay fotos.',
  // Orders
  'Orders': 'Órdenes',
  'Off. Turn it on to carry this save between your phone, browser and Steam Deck.': 'Desactivado. Actívalo para llevar esta partida entre tu móvil, el navegador y la Steam Deck.',
  'The story and conversations stay in English.': 'La historia y las conversaciones siguen en inglés.',
  // Help headings
  'Keyboard & mouse': 'Teclado y ratón', 'Controller': 'Mando', 'Touch': 'Táctil',
};

const DICTS = { es: ES };
export const LANGS = [['auto', 'Automatic'], ['en', 'English'], ['es', 'Español (interfaz)']];

export function lang() {
  const l = (G.settings && G.settings.language) || 'auto';
  if (l !== 'auto') return l;
  return typeof navigator !== 'undefined' && /^es\b/i.test(navigator.language || '') ? 'es' : 'en';
}
/** Translate one string (or return it unchanged). */
export function tr(s) {
  const d = DICTS[lang()];
  return (d && d[s]) || s;
}

function translateNode(node, d) {
  if (node.nodeType === 3) {
    const raw = node.nodeValue, t = raw.trim();
    if (t && d[t] && d[t] !== t) node.nodeValue = raw.replace(t, d[t]); // never rewrite a node to itself (it would wake the observer again)
    return;
  }
  if (node.nodeType !== 1 || node.closest('.dlg-body')) return; // the conversation itself stays as written
  if (node.tagName === 'OPTION' || node.tagName === 'BUTTON' || node.childNodes.length) for (const c of node.childNodes) translateNode(c, d);
}
/** Translate everything under these roots now, and whatever appears there later. */
let observer = null;
const ROOTS = ['title', 'hud', 'touch', 'modal-root', 'rotate-hint', 'dialogue'];
export function applyLanguage() {
  const d = DICTS[lang()];
  document.documentElement.lang = lang();
  if (observer) { observer.disconnect(); observer = null; }
  if (!d) return;
  for (const id of ROOTS) { const el = document.getElementById(id); if (el) translateNode(el, d); }
  const df = document.querySelector('.dlg-foot'); if (df) translateNode(df, d);
  observer = new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.type === 'characterData') translateNode(m.target, d);
      for (const n of m.addedNodes || []) translateNode(n, d);
    }
  });
  for (const id of ROOTS) { const el = document.getElementById(id); if (el) observer.observe(el, { childList: true, subtree: true, characterData: true }); }
}
