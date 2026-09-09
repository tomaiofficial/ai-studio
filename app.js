const courses=[
 {id:'pc',icon:'💻',title:'Les bases d’un ordinateur',desc:'Comprendre CPU, RAM, stockage et périphériques.',level:'Débutant',xp:50},
 {id:'windows',icon:'🪟',title:'Windows au quotidien',desc:'Fichiers, réglages, mises à jour et dépannage simple.',level:'Débutant',xp:60},
 {id:'network',icon:'🌐',title:'Comprendre les réseaux',desc:'IP, routeur, DNS, Wi-Fi et fonctionnement d’Internet.',level:'Intermédiaire',xp:80},
 {id:'code',icon:'⌨️',title:'Premiers pas en programmation',desc:'Variables, conditions, fonctions et logique de code.',level:'Débutant',xp:80},
 {id:'hardware',icon:'🧩',title:'Hardware & composants',desc:'Choisir, installer et comprendre les principaux composants.',level:'Intermédiaire',xp:70},
 {id:'privacy',icon:'🛡️',title:'Vie privée numérique',desc:'Réglages, données personnelles et bonnes pratiques.',level:'Débutant',xp:60}
];
const cyber=[
 {id:'passwords',icon:'🔑',title:'Mots de passe solides',desc:'Comprendre les bonnes pratiques et éviter les erreurs courantes.',level:'Débutant',xp:50},
 {id:'phishing',icon:'🎣',title:'Reconnaître le phishing',desc:'Apprendre à repérer les messages et sites suspects.',level:'Débutant',xp:70},
 {id:'accounts',icon:'🔐',title:'Protéger ses comptes',desc:'2FA, récupération et sécurité des comptes.',level:'Débutant',xp:60},
 {id:'malware',icon:'🦠',title:'Comprendre les malwares',desc:'Virus, chevaux de Troie et ransomware : comprendre les risques.',level:'Intermédiaire',xp:80},
 {id:'soc',icon:'🖥️',title:'Découverte d’un SOC',desc:'Simulation fictive : alertes, logs et analyse d’incidents.',level:'Intermédiaire',xp:100},
 {id:'networksec',icon:'🛡️',title:'Sécurité réseau',desc:'Notions de pare-feu, ports, services et segmentation.',level:'Intermédiaire',xp:100}
];
const questions=[
 {q:'Que signifie RAM ?',a:['Mémoire vive','Routeur automatique machine','Réseau avancé mondial'],correct:0},
 {q:'À quoi sert le DNS ?',a:['Traduire des noms de domaine en adresses IP','Refroidir le PC','Créer des mots de passe'],correct:0},
 {q:'Quel élément ajoute une protection supplémentaire à un compte ?',a:['2FA','Une capture d’écran','Le mode avion'],correct:0},
 {q:'Quel indice peut signaler un phishing ?',a:['Une URL étrange','Une connexion Wi-Fi','Un écran verrouillé'],correct:0}
];
let state=JSON.parse(localStorage.getItem('aiStudioState')||'null')||{name:'Utilisateur',done:[],xp:0,activities:[],quizIndex:0,quizScore:0,dark:false};
const $=id=>document.getElementById(id); const save=()=>localStorage.setItem('aiStudioState',JSON.stringify(state));
function renderCards(list,target){$(target).innerHTML=list.map(c=>`<article class="card course-card"><div class="icon">${c.icon}</div><h3>${c.title}</h3><p>${c.desc}</p><div class="course-bottom"><span class="tag">${c.level} · ${c.xp} XP</span><button class="primary" onclick="openCourse('${c.id}')">${state.done.includes(c.id)?'Revoir':'Commencer'}</button></div></article>`).join('')}
function render(){
 renderCards(courses,'courseGrid');renderCards(cyber,'cyberGrid');
 const all=[...courses,...cyber], pct=Math.round(state.done.length/all.length*100);$('overallProgress').textContent=pct+'%';$('overallBar').style.width=pct+'%';$('xp').textContent=state.xp+' XP';$('completed').textContent=state.done.length;
 const next=all.find(c=>!state.done.includes(c.id))||all[0];$('nextCourse').textContent=next.title;$('nextDesc').textContent=next.desc;$('nextLevel').textContent=next.level;$('startNext').onclick=()=>openCourse(next.id);
 $('activityList').innerHTML=state.activities.length?state.activities.slice(0,6).map(x=>`<div>• ${x}</div>`).join(''):'Aucune activité pour le moment.<br>Ton historique apparaîtra ici.';
 $('nameInput').value=state.name;
 $('progressDetails').innerHTML=all.map(c=>`<div style="display:flex;justify-content:space-between;padding:12px 0;border-bottom:1px solid #e5e7eb"><span>${c.icon} ${c.title}</span><strong>${state.done.includes(c.id)?'✓ Terminé':'À faire'}</strong></div>`).join('');
 if(state.dark)document.body.classList.add('dark');
}
function openCourse(id){const c=[...courses,...cyber].find(x=>x.id===id);if(!c)return; if(!state.done.includes(id)){state.done.push(id);state.xp+=c.xp;state.activities.unshift(`${c.title} terminé (+${c.xp} XP)`);state.activities=state.activities.slice(0,20);save();render();}alert(`${c.title}\n\n${c.desc}\n\nCours terminé dans cette version de démonstration. Tu gagnes ${c.xp} XP.`)}
function showSection(id){document.querySelectorAll('.section').forEach(s=>s.classList.remove('active-section'));$(id).classList.add('active-section');document.querySelectorAll('.nav').forEach(n=>n.classList.toggle('active',n.dataset.section===id));if(id==='quiz')renderQuiz()}
function renderQuiz(){const q=questions[state.quizIndex%questions.length];$('quizBox').innerHTML=`<span class="eyebrow">QUESTION ${(state.quizIndex%questions.length)+1}/${questions.length}</span><p class="quiz-question">${q.q}</p><div class="answers">${q.a.map((a,i)=>`<button class="answer" onclick="answerQuiz(${i})">${a}</button>`).join('')}</div><p>Score : <strong>${state.quizScore}</strong></p>`}
function answerQuiz(i){const q=questions[state.quizIndex%questions.length];if(i===q.correct){state.quizScore++;state.xp+=25;state.activities.unshift('Quiz réussi (+25 XP)');alert('Bonne réponse ! +25 XP 🎯')}else alert('Pas cette fois. Relis le cours associé puis réessaie.');state.quizIndex++;save();render();renderQuiz()}
function assistantAnswer(text){const t=text.toLowerCase();if(t.includes('ip'))return"Une adresse IP identifie un appareil sur un réseau. Pense à une adresse postale, mais pour communiquer sur un réseau informatique.";if(t.includes('dns'))return"Le DNS sert à traduire un nom comme exemple.fr en adresse IP afin que ton appareil puisse trouver le serveur.";if(t.includes('phishing'))return"Le phishing est une tentative de tromper quelqu’un pour lui faire révéler une information ou effectuer une action. Vérifie toujours l’expéditeur, l’adresse du site et les demandes inhabituelles.";if(t.includes('ram'))return"La RAM est une mémoire rapide utilisée temporairement par l’ordinateur pour garder les données dont les programmes ont besoin pendant leur fonctionnement.";if(t.includes('virus'))return"Un malware est un logiciel conçu pour nuire, espionner ou obtenir un accès non autorisé. Pour apprendre, utilise uniquement des simulations et des environnements de test.";return"Je peux t’expliquer les bases de l’informatique et de la cybersécurité. Essaie avec : adresse IP, DNS, RAM, phishing ou mots de passe."}
$('chatForm').addEventListener('submit',e=>{e.preventDefault();const input=$('chatInput'),text=input.value.trim();if(!text)return;$('chat').insertAdjacentHTML('beforeend',`<div class="bubble user">${escapeHtml(text)}</div><div class="bubble bot">${assistantAnswer(text)}</div>`);input.value='';$('chat').scrollTop=$('chat').scrollHeight;state.activities.unshift('Question posée au tuteur IA');save()});
function escapeHtml(s){return s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]))}
document.querySelectorAll('.nav').forEach(n=>n.addEventListener('click',()=>showSection(n.dataset.section)));
$('themeBtn').onclick=()=>{state.dark=!state.dark;document.body.classList.toggle('dark',state.dark);save()};$('profileBtn').onclick=()=>showSection('settings');$('saveName').onclick=()=>{state.name=$('nameInput').value.trim()||'Utilisateur';state.activities.unshift('Profil mis à jour');save();render();alert('Profil enregistré.')};$('resetData').onclick=()=>{if(confirm('Réinitialiser toute la progression ?')){state={name:'Utilisateur',done:[],xp:0,activities:[],quizIndex:0,quizScore:0,dark:state.dark};save();render()}};
render();
