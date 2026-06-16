// Firebase config for An II.
// ВАЖНО: это публичный web config Firebase, не service account и не приватный ключ.
// Вставь сюда свой объект из Firebase Console → Project settings → Your apps → Web app.
// Без databaseURL приложение не сможет читать Realtime Database.
window.FIREBASE_CONFIG = window.FIREBASE_CONFIG || {
  apiKey: "AIzaSyC_Y-V5OIG61B7x7H54RNVwPL3vBeeyvtM",
  authDomain: "french-da79a.firebaseapp.com",
  databaseURL: "https://french-da79a-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "french-da79a",
  appId: "1:534791612002:web:e9a9a990d351ced860133b"
};

// UID админа задаётся в Realtime Database: /admins/<uid> = true.
// Это имя пока оставлено для UI-логики приложения.
window.AN2_ADMIN_USERNAME = window.AN2_ADMIN_USERNAME || 'boikot5225';
