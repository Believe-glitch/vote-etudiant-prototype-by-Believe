// Mode clair ou sombre, et menu « trois barres » du téléphone.
//
// Ce petit fichier est chargé tout en haut de chaque page (dans <head>),
// AVANT l'affichage : ainsi la page apparaît tout de suite dans le bon mode,
// sans « flash » blanc.
//
// Le choix du mode :
//   1. si la personne a choisi un mode avec le bouton ◐, on le garde
//      (il est retenu dans son navigateur) ;
//   2. sinon, on suit le réglage du téléphone ou de l'ordinateur.
//
// C'est un script classique (pas un module) : il doit s'exécuter tout de suite.

(function () {
  'use strict';

  var CLE = 'urkimevote-theme';
  var racine = document.documentElement;
  var systeme = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  // Le navigateur peut refuser l'accès à sa mémoire (navigation privée) : on ne plante pas.
  function lireChoix() {
    try { return localStorage.getItem(CLE); } catch (erreur) { return null; }
  }
  function retenirChoix(valeur) {
    try { localStorage.setItem(CLE, valeur); } catch (erreur) { /* tant pis : le choix vaut pour cette page */ }
  }

  function modeVoulu() {
    var choix = lireChoix();
    if (choix === 'clair' || choix === 'sombre') return choix;
    return systeme && systeme.matches ? 'sombre' : 'clair';
  }

  function appliquer(mode) {
    racine.setAttribute('data-theme', mode);
    // Les boutons ◐ indiquent l'état (pour les lecteurs d'écran aussi).
    var boutons = document.querySelectorAll('.bouton-theme');
    for (var i = 0; i < boutons.length; i++) {
      boutons[i].setAttribute('aria-pressed', mode === 'sombre' ? 'true' : 'false');
      boutons[i].setAttribute('aria-label', mode === 'sombre' ? 'Passer en mode clair' : 'Passer en mode sombre');
      boutons[i].title = mode === 'sombre' ? 'Mode clair' : 'Mode sombre';
    }
    // Couleur de la barre du navigateur sur téléphone.
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', mode === 'sombre' ? '#0f1d36' : '#0b4fa3');
  }

  // 1. Tout de suite, avant l'affichage.
  appliquer(modeVoulu());

  // Si le réglage du téléphone change (ex. passage automatique en mode nuit)
  // et que la personne n'a rien choisi elle-même, on suit.
  if (systeme && systeme.addEventListener) {
    systeme.addEventListener('change', function () {
      if (!lireChoix()) appliquer(modeVoulu());
    });
  }

  // 2. Quand la page est prête : on branche les boutons.
  document.addEventListener('DOMContentLoaded', function () {
    appliquer(racine.getAttribute('data-theme'));

    var boutonsTheme = document.querySelectorAll('.bouton-theme');
    for (var i = 0; i < boutonsTheme.length; i++) {
      boutonsTheme[i].addEventListener('click', function () {
        var nouveau = racine.getAttribute('data-theme') === 'sombre' ? 'clair' : 'sombre';
        retenirChoix(nouveau);
        appliquer(nouveau);
      });
    }

    // Le menu « trois barres » (téléphone et tablette).
    var boutonMenu = document.querySelector('.bouton-menu');
    var menu = document.getElementById('menu-principal');
    if (!boutonMenu || !menu) return;

    function ouvrirMenu(ouvert) {
      menu.classList.toggle('ouvert', ouvert);
      boutonMenu.setAttribute('aria-expanded', ouvert ? 'true' : 'false');
      boutonMenu.setAttribute('aria-label', ouvert ? 'Fermer le menu' : 'Ouvrir le menu');
    }
    boutonMenu.addEventListener('click', function () {
      ouvrirMenu(boutonMenu.getAttribute('aria-expanded') !== 'true');
    });
    // On ferme le menu avec la touche Échap, ou en touchant ailleurs.
    document.addEventListener('keydown', function (evenement) {
      if (evenement.key === 'Escape' && menu.classList.contains('ouvert')) {
        ouvrirMenu(false);
        boutonMenu.focus();
      }
    });
    document.addEventListener('click', function (evenement) {
      if (!menu.classList.contains('ouvert')) return;
      if (menu.contains(evenement.target) || boutonMenu.contains(evenement.target)) return;
      ouvrirMenu(false);
    });
  });
})();
