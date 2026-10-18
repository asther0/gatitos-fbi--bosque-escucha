(() => {
  'use strict';
  const menuButton = document.querySelector('.menu-toggle');
  const nav = document.getElementById('main-nav');
  menuButton.addEventListener('click', () => {
    const open = menuButton.getAttribute('aria-expanded') !== 'true';
    menuButton.setAttribute('aria-expanded', String(open));
    nav.classList.toggle('is-open', open);
  });
  nav.querySelectorAll('a').forEach(link => link.addEventListener('click', () => {
    nav.classList.remove('is-open'); menuButton.setAttribute('aria-expanded', 'false');
  }));
  const byId = id => document.getElementById(id);
  byId('pilot-form').addEventListener('submit', event => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const content = ['BOSQUE ESCUCHA — PROPUESTA DE PILOTO', '', 'Borrador preparado por el visitante. No enviado ni registrado.', '', `Nombre o equipo: ${data.get('name').trim()}`, `Función: ${data.get('role')}`, `Área: ${data.get('area').trim()}`, '', 'Qué se propone evaluar:', data.get('need').trim(), '', 'Siguiente paso: compartir este archivo con el equipo por un canal acordado.', 'Este borrador no confirma una reunión, aprobación, compra ni contratación.'].join('\n');
    const url = URL.createObjectURL(new Blob(['\ufeff', content], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = 'propuesta-piloto-bosque-escucha.txt'; document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    byId('pilot-status').textContent = 'Propuesta preparada para descargar. No se enviaron tus datos.';
  });
})();
