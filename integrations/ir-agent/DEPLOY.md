# Déploiement, dry-run et raccordement — IR Agent

Toutes les étapes marquées 🔒 modifient la production ou Paperclip : à exécuter
uniquement avec l'autorisation explicite de Privann.

## Contexte vérifié (VPS `vps-938f60ce`, 2026-09-29)

| Élément | Valeur |
|---|---|
| Application Coolify | `papermark-roomjettcity` (id 6, uuid `zvya0ugmerdrpqbs91jdxpvm`), projet `papermark`, env `production` |
| Conteneur actif | `zvya0ugmerdrpqbs91jdxpvm-141157387097`, image `zvya0ugmerdrpqbs91jdxpvm:aab17345…` (3,16 Go) |
| Build | Nixpacks, Node 20, `npm install --include=dev` + `next build`, source `github.com/privann0/papermark` branche `main` (clone GitHub : les fichiers locaux non commités ne sont jamais embarqués) |
| Déploiement | **auto-deploy activé** : tout push sur `myfork/main` redéploie la production |
| Rétention d'images | `docker_images_to_keep=2` ; le nettoyage nocturne forcé (seuil 80 %) conserve les 2 images les plus récentes de l'application |
| Health check Coolify | désactivé |
| Base | PostgreSQL Coolify `k1eeaukwox6s836say5fbgx4`, base `papermark` (18 Mo, 119/119 migrations) ; aucune migration requise |
| Disque | un seul disque `/dev/sda1` : 23 Go libres (89 %) |

## Espace nécessaire (mesuré)

| Poste | Taille | Emplacement |
|---|---|---|
| Dump PostgreSQL `-Fc` | 3,6 Mo | local + Filen |
| Image `aab17345` (`docker save | gzip -1`, ~3 min) | 1,08 Go | local **temporaire**, puis Filen ; copie locale supprimée après vérification |
| Nouveau build (couches npm 2,28 Go + build 0,16 Go + COPY, cache BuildKit) | ~2,5 Go durable, pic ~3,5–4 Go | Docker |

Pic local : ~1,1 Go (sauvegarde) puis ~4 Go (build) → ≥ 18 Go libres restants (~91 %).
`gdrive:` (rclone) est inutilisable (jeton expiré / compte restreint) ; Filen est
opérationnel (2,05 Tio, 140 Gio utilisés).

## 1. Sauvegardes hors VPS 🔒

```bash
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
B=~/backups/papermark-predeploy-$STAMP
mkdir -m 700 "$B"

docker exec k1eeaukwox6s836say5fbgx4 sh -c 'pg_dump -U "$POSTGRES_USER" -d papermark -Fc' \
  > "$B/papermark-db-$STAMP.dump"
docker save zvya0ugmerdrpqbs91jdxpvm:aab17345ee614f4915f60514202efee36637a6fa \
  | nice -n 19 gzip -1 > "$B/papermark-image-aab17345-$STAMP.tar.gz"
chmod 600 "$B"/*
(cd "$B" && sha256sum * > SHA256SUMS)
gzip -t "$B/papermark-image-aab17345-$STAMP.tar.gz" && echo "image archive OK"
docker exec -i k1eeaukwox6s836say5fbgx4 pg_restore --list < "$B/papermark-db-$STAMP.dump" | head -3

for f in "$B"/*; do filen upload "$f" "/JETT Pod/VPS Backups/"; done
filen ls "/JETT Pod/VPS Backups/" | grep "$STAMP"          # 3 fichiers attendus
rm "$B/papermark-image-aab17345-$STAMP.tar.gz"            # libère 1,08 Go ; le dump reste en local
df -h /
```

## 2. Déploiement 🔒

La branche part de `aab17345` (= `myfork/main` = production). Le déploiement est une
**avance rapide** de `main`, sans merge ni rebase :

```bash
cd ~/papermark-src
git fetch myfork main
git merge-base --is-ancestor myfork/main feat/ir-agent-sync && echo "fast-forward OK"
git push myfork feat/ir-agent-sync                 # sauvegarde de la branche, ne déploie pas
git push myfork feat/ir-agent-sync:main            # ⇒ auto-deploy Coolify
```

Suivre le build dans Coolify. Si le build échoue, l'ancien conteneur reste en place.

Vérifications :

```bash
curl -s -o /dev/null -w "views sans token: %{http_code}\n" https://room.jett.city/api/agent/ir/views  # 401 attendu (et non 404)
curl -s -o /dev/null -w "ir historique:    %{http_code}\n" https://room.jett.city/api/agent/ir        # 401 attendu
curl -s -o /dev/null -w "accueil:          %{http_code}\n" https://room.jett.city/
docker ps --format '{{.Names}}\t{{.Image}}\t{{.Status}}' | grep zvya0ugmerdrpqbs91jdxpvm
```

## 3. Retour arrière 🔒

- **Rapide (sans rebuild)** : Coolify → *Deployments* → `aab17345` → *Rollback*
  (image conservée localement par la rétention `docker_images_to_keep=2`). Si elle a
  disparu : `filen download` de l'archive, `gunzip -c … | docker load`, puis *Rollback*.
- **Par Git** : `git revert` du commit IR sur une branche, puis push en avance rapide sur
  `myfork/main` (auto-deploy). Pas de force-push.
- **Base** : non modifiée par ce déploiement ; le dump ne sert qu'en cas d'incident.

## 4. Validation de l'endpoint puis dry-run sur les vraies données (lecture seule)

```bash
cd ~/papermark-src
integrations/ir-agent/store-token.sh          # saisie masquée, une seule fois

# Contrat de l'endpoint : codes 401/405/400, champs, fenêtre de stabilisation, pagination
IR_PAPERMARK_TOKEN_FILE=~/.config/jett-ir-agent/papermark.token \
python3 integrations/ir-agent/check_endpoint.py --since 2026-09-29T00:00:00+02:00
# attendu : "OK: 15/15 checks passed"

# Premier dry-run : rien d'écrit, aucun appel Paperclip, emails masqués
IR_PAPERMARK_TOKEN_FILE=~/.config/jett-ir-agent/papermark.token \
IR_SYNC_START=2026-09-29T00:00:00+02:00 \
IR_EXCLUDE_EMAIL_DOMAINS=jett.city \
IR_STATE_DIR=$(mktemp -d) \
python3 integrations/ir-agent/ir_agent.py --dry-run --show-report
```

Référence SQL (lecture seule, 2026-09-29 10:05 UTC) : depuis le 29/09 00:00 Paris,
**7 vues, toutes anonymes, 0 archivée, 0 interne**. Le dry-run doit donner
`new_views` = ce total moins les vues de moins de 2 min, `anonymous_views` cohérent,
`"complete": true`, `"ok": true`.

Rapport historique séparé (aucun ticket, aucun état ; fichier 0600, contient des emails) :

```bash
IR_PAPERMARK_TOKEN_FILE=~/.config/jett-ir-agent/papermark.token \
IR_SYNC_START=2026-09-29T00:00:00+02:00 IR_EXCLUDE_EMAIL_DOMAINS=jett.city \
python3 integrations/ir-agent/ir_agent.py --historical-report ~/backups/ir-historique-$(date +%F).md
```

Référence SQL : 128 vues avant le 29/09 (3 archivées, 6 internes, 58 avec email déclaré
pour 38 visiteurs distincts, 61 anonymes).

## 5. Raccordement IR Agent → CMO 🔒 (modifie Paperclip)

1. `adapterConfig` de l'IR Agent (`a7a534d9-e1d3-42da-8b5b-a87fe8964724`) :

   ```json
   {
     "command": "/usr/bin/python3",
     "args": ["/home/privann/papermark-src/integrations/ir-agent/ir_agent.py"],
     "cwd": "/home/privann/papermark-src/integrations/ir-agent",
     "timeoutSec": 300,
     "env": {
       "IR_PAPERMARK_URL": "https://room.jett.city",
       "IR_PAPERMARK_TOKEN_FILE": "/home/privann/.config/jett-ir-agent/papermark.token",
       "IR_SYNC_START": "2026-09-29T00:00:00+02:00",
       "IR_CMO_AGENT_ID": "174c6f3f-e5e2-41ac-b6a8-1e3f4080bd37",
       "IR_HANDOFF_STATUS": "backlog",
       "IR_EXCLUDE_EMAIL_DOMAINS": "jett.city"
     }
   }
   ```

   Le heartbeat reste désactivé.
2. Un heartbeat manuel : `invoke_agent_heartbeat` sur l'IR Agent.
3. Vérifier : run terminé avec code 0 ; une issue `backlog` assignée au CMO, titre
   `IR — activité Papermark : … [xxxxxxxx]` ; le CMO **n'a pas** été réveillé.
4. Second heartbeat manuel : `"sent": []`, aucune nouvelle issue (idempotence).
5. Passage en `todo` (réveil du CMO) et planification : décisions séparées.
