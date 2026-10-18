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
  const preview = document.getElementById('preview-login');
  document.getElementById('open-preview').addEventListener('click', () => preview.showModal());
  preview.querySelector('.preview-close').addEventListener('click', () => preview.close());
  preview.addEventListener('click', event => { if (event.target === preview) { const box = preview.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) preview.close(); } });
  document.getElementById('preview-login-form').addEventListener('submit', event => {
    event.preventDefault();
    window.location.assign('https://bosque-escucha.vercel.app');
  });
})();
