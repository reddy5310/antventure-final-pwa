# 🐜 Antventure: Leaf of Fate

A lightweight progressive web game where an ant floats on a drifting banana leaf down a river, dodging raindrops to survive.

---

## 🎮 Game Features

- 🎵 **Background Music & Rain Sounds**
- 🍃 **Realistic Leaf Drift Animation**
- 🪲 **Ant Skins** using image rendering
- 📊 **Firebase-Powered Global Scoreboard** (extensible)
- 📱 **Installable PWA** (Add to Home Screen on mobile)
- ⚡ **Offline Support** with Service Worker
- 🧠 Clean UI/UX with responsive touch support

---

## 🚀 Live Game

👉 [Play Now on GitHub Pages](https://reddy5310.github.io/antventure-final-pwa/)

---

## 🗂 Folder Structure

```
antventure-final-pwa/
├── index.html
├── manifest.json
├── service-worker.js
├── README.md
├── icon-192.png
├── icon-512.png
├── audio/
│   ├── bgm.mp3
│   └── rain.mp3
├── assets/
│   └── ant.png
```

---

## 🧪 How to Run Locally

```bash
git clone https://github.com/reddy5310/antventure-final-pwa.git
cd antventure-final-pwa
# Open index.html in browser
```

Or use a live server like VS Code extension "Live Server".

---

## 🔧 Firebase Scoreboard Setup (Optional)

Want to show global high scores? Here’s how:

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Create a new project → Enable **Realtime Database**
3. Set database rules:
   ```json
   {
     "rules": {
       ".read": true,
       ".write": true
     }
   }
   ```
4. Get config from:
   `Project settings → SDK setup → CDN`
5. Add to `index.html` like this:
   ```html
   <script src="https://www.gstatic.com/firebasejs/9.0.0/firebase-app.js"></script>
   <script src="https://www.gstatic.com/firebasejs/9.0.0/firebase-database.js"></script>
   <script>
     const firebaseConfig = { ... }; // paste your config here
     firebase.initializeApp(firebaseConfig);
     const db = firebase.database();

     function saveScore(name, score) {
       db.ref("scores").push({ name, score });
     }
   </script>
   ```

---

## 📲 How to Install as App (PWA)

- On **Android Chrome**:  
  Tap ⋮ → Add to Home Screen → Install

- On **iPhone Safari**:  
  Tap Share → Add to Home Screen

---

## 🧑‍💻 Developer Info

**Developed by:** Satya  
📧 Email: mnvdsreddy93@gmail.com

---

## 📝 License

MIT License – free to modify and share.
