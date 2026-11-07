# Projet en attente : caméra du réfectoire (file d'attente + tables)

> **Statut : en attente de lancement.** Le code est prêt mais **inactif** : tant qu'aucune caméra n'envoie de
> relevés, l'appli continue d'estimer l'affluence à partir des scans, exactement comme avant.
> On lance ensemble le jour J en suivant ce guide (≈ 1 h sur place).

## L'idée

Un vieux téléphone posé dans un angle du réfectoire filme en continu. Un ordinateur sur le même Wi-Fi
analyse l'image avec YOLO (détection de personnes) et envoie **uniquement des chiffres** à l'appli :

- **file d'attente** : combien de personnes dans le couloir d'entrée ;
- **tables** : lesquelles sont occupées ;
- **comptoir** : combien de personnes se servent.

L'étudiant voit à distance : « 14 dans la file · ~4 min d'attente ». L'attente est calculée avec le
**rythme réel du comptoir** (nombre de tickets scannés ces 10 dernières minutes), pas devinée.

```
 Téléphone (IP Webcam) ──Wi-Fi──▶ Ordinateur (YOLO, vision/occupancy.py) ──chiffres──▶ Supabase ──▶ appli
                                        aucune image enregistrée ni envoyée
```

## Le plan du réfectoire (à dessiner avec l'outil de calibrage)

```
  ┌───────────────────────────────────────────────┐
  │ ENTRÉE                                         │
  │  ┌─────────────────────────┐ ┌──────────┐      │
  │  │ FILE D'ATTENTE (couloir)│▶│ COMPTOIR │      │
  │  └─────────────────────────┘ └──────────┘      │
  │                         ┌──┐ ┌──┐ ┌──┐ ┌──┐    │
  │                         │T1│ │T2│ │T3│ │T4│    │  ← tables (partie droite)
  │                         └──┘ └──┘ └──┘ └──┘    │
  │                         ┌──┐ ┌──┐ ┌──┐ ┌──┐    │
  │                         │T5│ │T6│ │T7│ │T8│    │
  └───────────────────────────────────────────────┘
       📱 téléphone dans un angle, en hauteur, qui voit le couloir ET les tables
```

C'est **nous** qui délimitons les zones, directement sur l'image de la caméra : on clique les coins du
couloir, du comptoir et de chaque table. On peut les corriger à tout moment.

## Ce qu'il faut

| Matériel | Détail |
|---|---|
| 1 téléphone Android | un ancien suffit (Android 6+), caméra arrière correcte |
| 1 support | pince / ventouse / perche, fixé à **2,5 – 3 m** de haut dans un angle |
| 1 chargeur + rallonge | le téléphone reste branché 24 h/24 |
| 1 ordinateur | PC portable de la cantine, mini-PC ou Raspberry Pi 5, **sur le même Wi-Fi** |
| Wi-Fi | le même réseau pour le téléphone et l'ordinateur |
| Autorisation | accord de l'école + affiche « zone d'analyse de l'affluence, aucune image conservée » |

| Logiciel | Où | Rôle |
|---|---|---|
| **IP Webcam** (Play Store, gratuit) | téléphone | transforme le téléphone en caméra réseau |
| Python 3.10+ | ordinateur | fait tourner l'analyse |
| `vision/` de ce dépôt | ordinateur | YOLO11n + zones + envoi des chiffres |

## Le jour du lancement, pas à pas

### 1. Le téléphone (10 min)

1. Installer **IP Webcam**, l'ouvrir, descendre tout en bas : **« Démarrer le serveur »**.
2. Noter l'adresse affichée à l'écran, par ex. `http://192.168.1.20:8080`.
3. Réglages conseillés dans l'appli : résolution **1280×720**, qualité 50 %, « Empêcher la mise en veille » activé.
4. Réglages Android : désactiver l'économie de batterie pour IP Webcam, laisser le chargeur branché.
5. Fixer le téléphone dans l'angle, en hauteur, qui voit **le couloir, le comptoir et les tables**.

Vérification : sur l'ordinateur, ouvrir `http://192.168.1.20:8080` dans un navigateur, l'image s'affiche.

### 2. L'ordinateur (15 min)

```bash
git clone https://github.com/Bryan-Taffo-Stephen-Yves/dabali.git
```

```bash
cd dabali/vision
```

```bash
python -m venv .venv && source .venv/bin/activate     # Windows : .venv\Scripts\activate
```

```bash
pip install -r requirements.txt
```

Créer le fichier `vision/.env` à partir de `vision/.env.example` :

```
SUPABASE_URL=https://punghxwtknejxkedaoty.supabase.co
SUPABASE_SERVICE_ROLE_KEY=…    (à copier depuis Supabase → Project Settings → API ; ne jamais la partager)
ROOM_ID=…                      (identifiant du réfectoire, je le fournis le jour J)
VIDEO_SOURCE=http://192.168.1.20:8080/video
```

### 3. Le calibrage : dessiner les zones (15 min)

```bash
python calibrate.py --source http://192.168.1.20:8080/video
```

Une fenêtre s'ouvre avec l'image de la caméra :

| Touche | Action |
|---|---|
| **1** | mode **tables** (vert) |
| **2** | mode **file d'attente** (orange) — dessiner le couloir où l'on fait le rang |
| **3** | mode **comptoir** (bleu) |
| clic gauche | ajouter un coin |
| **Entrée** | fermer la zone |
| Retour arrière | annuler le dernier coin |
| **Z** | supprimer la dernière zone du mode en cours |
| **S** | enregistrer `zones.json` |
| Échap | quitter |

Conseil : la zone d'une table inclut ses chaises ; la file d'attente suit le sol du couloir (YOLO regarde où
sont **les pieds** des personnes).

### 4. Le test à blanc (10 min)

```bash
python occupancy.py --preview --dry-run
```

Une fenêtre montre les zones colorées et les personnes détectées ; le terminal affiche les chiffres
(`"queue_count": 6`, tables occupées…) **sans rien envoyer**. Quelqu'un fait la queue, s'assoit : on vérifie
que les compteurs bougent.

### 5. Le lancement

```bash
python occupancy.py
```

Un relevé part toutes les 10 s. Dans l'appli :

- étudiants : la carte **Réfectoire** affiche « N dans la file · ~X min d'attente » ;
- admin → **Affluence** : badge « Caméra en direct », plan des tables, file d'attente.

Pour que ça tourne tout seul au démarrage de l'ordinateur : tâche planifiée Windows ou service `systemd`
(je le configure le jour J).

## Vie privée (argument fort pour le jury)

- Uniquement la classe « personne » de YOLO, **aucune reconnaissance faciale**.
- **Aucune image n'est enregistrée ni envoyée** : seuls des nombres partent vers Supabase. C'est vérifié
  automatiquement par un test (`vision/test_occupancy.py` interdit `imwrite`, `VideoWriter`, envoi de fichiers…).
- Loi ivoirienne n° 2013-450 sur les données personnelles (ARTCI) : informer par affichage, ne rien conserver.
- Option à décider plus tard : une photo **floutée** pour l'équipe uniquement (pas pour les étudiants).

## Ce qui est déjà prêt dans le code

| Élément | Fichier | État |
|---|---|---|
| Analyse YOLO11n, tables + file + comptoir, lissage | `vision/occupancy.py` | prêt, testé (7 tests) |
| Outil de calibrage des 3 types de zones | `vision/calibrate.py` | prêt |
| Exemple de zones | `vision/zones.example.json` | prêt |
| Colonnes `queue_count` / `counter_count` + calcul de l'attente | migration `20261107183141_queue_vision.sql` | en base, **inactif sans caméra** |
| Affichage « N dans la file · ~X min » | `occupancy-card.tsx`, admin Affluence | prêt, n'apparaît qu'avec la caméra |

## En cas de souci

| Symptôme | Solution |
|---|---|
| « Impossible d'ouvrir la source vidéo » | téléphone et ordinateur sur le même Wi-Fi ? serveur IP Webcam démarré ? adresse terminée par `/video` |
| L'image se fige | désactiver l'économie de batterie du téléphone, rebrancher le chargeur |
| Personnes non détectées | téléphone plus haut / plus près, meilleur éclairage, résolution 1280×720 |
| La file compte des passants | redessiner le couloir plus étroit (touche 2, puis Z pour effacer l'ancienne zone) |
| L'appli dit « estimation » | aucun relevé depuis 2 min : vérifier que `occupancy.py` tourne et que `.env` est rempli |
