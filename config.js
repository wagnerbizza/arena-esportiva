/*
  CONFIGURAÇÃO — ARENA ESPORTIVA

  demo: false
  Usa o Firebase para login, dados e placares em tempo real.

  demo: true
  Usa a demonstração local deste navegador.

  Mantenha os emuladores desativados.
  Nunca coloque senhas ou chaves privadas neste arquivo.
*/

window.CONFIG = {
  demo: false,

  firebase: {
    apiKey: "AIzaSyCH0vjpkz-eIE2IyEx-1wtHuKRXjJBM1sY",
    authDomain: "arena-esportiva-978bd.firebaseapp.com",
    projectId: "arena-esportiva-978bd",
    storageBucket: "arena-esportiva-978bd.firebasestorage.app",
    messagingSenderId: "100483898871",
    appId: "1:100483898871:web:c3143bb2da5c7e53be22f2",
  },

  emulators: {
    enabled: false,
    host: "127.0.0.1",
    firestorePort: 8080,
    authPort: 9099,
  },
};