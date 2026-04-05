# NodeTemplate
template compose stack for node applications run through docker (not requiring the install of dependancies directly to a system))
just run docker compose up and go to localhost:8888
if you want node packages run npm in the dockerfile and rebuild the container

### access compose service while running 
docker compose exec node sh

### for cloning

git remote add origin git@github.com:sshremote
git branch -M main
git push -u origin main
