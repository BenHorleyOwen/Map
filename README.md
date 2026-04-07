# Manhunt Map
small game "Seek" built to be hosted on a NodeJS container, I personaly initiate this with a tailscale VPN to play with my friends.

## Setup
to deploy this yourself you need a tailnet and docker (and friends willing to put up with you and install tailscale).
- create a tailscale access key to give to your container (tailscale dash -> settings -> personal -> keys).
  - I made mine have a tag for "container", with reuse enabled and a long expiry.
- place the key under "TS_AUTHKEY" in a .env, for compose to give to the sidecar.
- when pulling up the compose the machines list should display the node.
- you want to connect to the "game-node.tail{yournumbers}.ts.net" for https.
