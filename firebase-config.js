// Firebase Configuration and Initialization
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';
import { getFirestore, collection, doc, getDocs, getDoc, setDoc, updateDoc, deleteDoc, query, where } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';

// Your web app's Firebase configuration
const firebaseConfig = {
    apiKey: "AIzaSyCrPzWq9Plt-1XIKHigwFjCKce79F-wE34",
    authDomain: "word-analyzer-web-app.firebaseapp.com",
    projectId: "word-analyzer-web-app",
    storageBucket: "word-analyzer-web-app.firebasestorage.app",
    messagingSenderId: "849063805678",
    appId: "1:849063805678:web:bd39660bd5b1e8168969ff",
    measurementId: "G-SV2V0YBMVY"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const googleProvider = new GoogleAuthProvider();
// Force account selection popup every time (allows switching accounts)
googleProvider.setCustomParameters({ prompt: 'select_account' });

// Export for use in other modules
export { auth, db, googleProvider, signInWithPopup, onAuthStateChanged, signOut, collection, doc, getDocs, getDoc, setDoc, updateDoc, deleteDoc, query, where };
