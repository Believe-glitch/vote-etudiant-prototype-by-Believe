// Mode clair ou sombre, et menu « trois barres » du téléphone.
//
// Ce petit fichier est chargé tout en haut de chaque page (dans <head>),
// AVANT l'affichage : ainsi la page apparaît tout de suite dans le bon mode,
// sans « flash » blanc.
//
// Le choix du mode :
//   1. si la personne a choisi un mode, on le garde (il est retenu dans son navigateur) ;
//   2. sinon, le site s'ouvre en mode clair et, sur les pages publiques, une petite
//      fenêtre demande tout de suite : « Mode clair ou sombre ? » (une seule fois).
//
// C'est un script classique (pas un module) : il doit s'exécuter tout de suite.

(function () {
  'use strict';

  var CLE = 'urkimevote-theme';
  var racine = document.documentElement;

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
    return 'clair';   // le mode de départ, avant que la personne ait choisi
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

  // Le dessin du bouton ◐ (le même que dans la barre du haut).
  var DESSIN_MODE = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" ' +
    'stroke="currentColor" stroke-width="2"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor"/></svg>';

  // La fenêtre « Mode clair ou sombre ? », à la première visite.
  // Elle bloque la page ; un clic sur le rond change le mode en direct ; « Continuer » retient le choix.
  // Pas sur l'Espace officiels, ni sur un résultat ouvert pour la projection (/resultats?scrutin=…).
  function demanderLeMode() {
    if (lireChoix()) return;
    if (location.pathname.indexOf('/admin') === 0) return;
    if (/[?&]scrutin=/.test(location.search)) return;
    if (typeof HTMLDialogElement !== 'function') return;

    var fenetre = document.createElement('dialog');
    fenetre.className = 'choix-mode';
    fenetre.setAttribute('aria-labelledby', 'choix-mode-titre');
    fenetre.innerHTML =
      '<h2 id="choix-mode-titre">Bienvenue sur URKIMeVote</h2>' +
      '<p>Mode clair ou sombre ? Touchez le rond pour changer.</p>' +
      '<button type="button" class="choix-mode-rond">' + DESSIN_MODE + '</button>' +
      '<p class="choix-mode-etat" aria-live="polite"></p>' +
      '<button type="button" class="bouton choix-mode-continuer">Continuer</button>';
    document.body.appendChild(fenetre);

    var rond = fenetre.querySelector('.choix-mode-rond');
    var etat = fenetre.querySelector('.choix-mode-etat');
    function montrerEtat() {
      var sombre = racine.getAttribute('data-theme') === 'sombre';
      etat.textContent = sombre ? 'Mode sombre' : 'Mode clair';
      rond.setAttribute('aria-label', sombre ? 'Passer en mode clair' : 'Passer en mode sombre');
    }
    function terminer() {
      retenirChoix(racine.getAttribute('data-theme'));
      if (fenetre.open) fenetre.close();
      fenetre.remove();
    }
    rond.addEventListener('click', function () {
      appliquer(racine.getAttribute('data-theme') === 'sombre' ? 'clair' : 'sombre');
      montrerEtat();
    });
    fenetre.querySelector('.choix-mode-continuer').addEventListener('click', terminer);
    // La touche Échap garde le mode affiché, comme « Continuer ».
    fenetre.addEventListener('cancel', function (evenement) { evenement.preventDefault(); terminer(); });

    montrerEtat();
    fenetre.showModal();
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

    demanderLeMode();

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
