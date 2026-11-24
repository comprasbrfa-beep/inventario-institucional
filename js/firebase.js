
import {
    initializeApp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";

import {
    getAuth,
    GoogleAuthProvider
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import {
    getFirestore
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyDzvASHmZfCEy-dGl_ZH9vUIOA5asffNPw",
    authDomain: "inventarioinstitucional-9fa6c.firebaseapp.com",
    projectId: "inventarioinstitucional-9fa6c",
    storageBucket: "inventarioinstitucional-9fa6c.firebasestorage.app",
    messagingSenderId: "797915718345",
    appId: "1:797915718345:web:c6a5ea583f7043831aa318"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();
const db = getFirestore(app);

export {
    app,
    auth,
    googleProvider,
    db
};
