import { extendObservable, action, computed, autorun } from "mobx";
import { now } from "mobx-utils";
import debounce from "lodash/debounce";
import Axios from "axios";
import crypto from "crypto";

const CLIENT_ID = process.env.REACT_APP_SPOTIFY_CLIENT_ID;
const REDIRECT_URI = window.location.origin + "/auth";

/**
 * PlayerStore manages state and logic for spotify playback sdk.
 */
export class PlayerStore {
  constructor(messenger) {
    this.messenger = messenger;
    this.disposeTimeAutorun = undefined;
    this.disposeVolumeAutorun = undefined;
    extendObservable(this, {
      // property on whether or player should be strict
      // strict means that it only allows play pause seek track change by pogify
      // if strict: don't allow playing when paused, don't allow seeking, don't allow track change
      strict: false,
      // Spotify playback sdk object
      player: undefined,
      // Device id of Spotify playback sdk
      device_id: "",
      // Access token to spotify
      access_token: "",
      // when access_token expires
      expires_at: 0,
      // error stuff
      // TODO: replace with proper handling
      error_type: "",
      error_message: "",
      p0: 0,
      // when position was stamped
      t0: Date.now(),
      // rolling stamp to force computed position to update
      t1: Date.now(),
      // Whether player is playing
      playing: false,
      // volume
      volume: 0.2,
      // uri for current track
      uri: "",
      // WebPlaybackStateObject
      data: {},
    });
  }

  /**
   * Computed position based on previous timestamps and current time
   */
  position = computed(() => {
    // if playing calculate based on timestamps
    if (this.playing) {
      return Math.floor(this.p0 + this.t1 - this.t0);
    } else {
      // if paused return return based on set position
      return Math.floor(this.p0);
    }
  });

  /**
   * Resume player.
   * Should be called here instead of calling directly to spotify player object
   */
  resume = action(() => {
    // player resume method
    this.player.resume();
    // set state playing
    this.playing = true;
    // replaced ticking with autorun and now() from mobxUtils
    this.disposeTimeAutorun = autorun(async () => {
      this.t1 = now(500)
    })
    this.disposeVolumeAutorun = autorun(async () => {
      now(100)
      if (!this.debouncedVolumeChange.pending())
        this.volume = await this.player.getVolume()
    })
  });

  /**
   * Pause player.
   * Should be called here instead of calling directly to spotify player object
   */
  pause = action(() => {
    // spotify player pause method
    this.player.pause();
    // set pause state
    this.playing = false;
    // dispose autorun
    if (typeof this.disposeAutorun === "function") this.disposeAutorun()
  });

  /**
   * Toggle playback.
   * Should call here instead of calling directly to spotify player object.
   */
  togglePlay = action(() => {
    if (this.playing) {
      this.pause();
    } else {
      this.resume();
    }
  });

  /**
   * Sets volume
   */
  debouncedVolumeChange = debounce((volume) => {
    this.player.setVolume(volume);
  }, 50, {
    maxWait: 100,
    leading: true
  })
  setVolume = action((volume) => {
    this.volume = volume;
    this.debouncedVolumeChange(volume)
  });

  /**
   * Sets new track.
   *
   * @param {string} uri track uri
   * @param {number} pos_ms millisecond position
   */
  newTrack = async (uri, pos_ms) => {
    this.prevPlaying = this.playing;
    let res = await Axios.put(
      `https://api.spotify.com/v1/me/player/play?device_id=${this.device_id}`,
      {
        uris: [uri],
        position_ms: pos_ms,
      },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.access_token}`,
        },
      }
    );
    return res.data;
    // TODO: error handlers.
  };

  /**
   * Seeks to a location.
   * Call this instead of using seek on spotify playback object
   *
   * @param {number} pos_ms millisecond position
   */
  seek = action((pos_ms) => {
    // seek spotify playback sdk
    this.player.seek(pos_ms);
    // reset stamps
    this.p0 = pos_ms;
    this.t0 = Date.now();
  });

  /**
   * Initialize spotify playback object
   *
   * @param {string} title
   * @param {boolean} connect optional. Whether or not to connect spotify to pogify device
   */
  initializePlayer = action((title, connect = true) => {
    return new Promise(async (resolve, reject) => {
      // if player is already connected update name and whether its host, then return
      if (this.player && this.player.setName) {
        await this.player.setName(title);
        return resolve();
      }
      // if spotify is not ready then wait till ready then call this function
      // TODO: add timeout for waiting or something (care for slow connections)
      if (!window.spotifyReady) {
        window.onSpotifyWebPlaybackSDKReady = () => {
          // set global tracker to true
          window.spotifyReady = true;

          // now call this function
          this.initializePlayer(title)
            .then(() => {
              resolve();
            })
            .catch((e) => {
              reject(e);
            });
        };
      }

      // make spotify playback sdk object
      let player = new window.Spotify.Player({
        volume: this.volume,
        name: title,
        getOAuthToken: async (callback) => {
          let token = await this.getOAuthToken();
          callback(token);
        },
      });
      // authentication_error handler
      player.on("initialization_error", reject);
      player.on("authentication_error", ({ message }) => {
        this.error_type = "authentication_error";
        this.error_message = message;
      });

      // TODO: proper error handling
      player.on("account_error", ({ message }) => {
        this.error_type = "account_error";
        this.error_message = message;
      });
      player.on("playback_error", ({ message }) => {
        this.error_type = "authentication_error";
        this.error_message = message;
      });
      player.on("not_ready", () => {
        this.error_type = "not_ready";
        this.error_message = "Player not Ready";
      });

      // update this player stuff on player state
      player.on("player_state_changed", async (data) => {
        // if no data then do nothing
        // TODO: host connected to pogify property
        if (!data) {
          this.data = {};
          return;
        }
        // set player uri to update's uri
        this.uri = data.track_window.current_track.uri;

        this.p0 = data.position;
        this.t0 = Date.now();

        if (!data.paused) {
          this.resume();
        } else {
          this.pause();
        }

        console.log(data);

        this.data = data;
      });

      // ready callback
      player.on("ready", ({ device_id }) => {
        // set device id
        this.device_id = device_id;
        // clear player object if it already exists
        this.player = undefined;
        this.player = player;

        // if connect is true call connect to player
        if (connect) {
          this.connectToPlayer(device_id).then(() => {
            resolve();
          });
          // TODO: error handling
        } else {
          resolve();
        }
      });

      // start connecting player
      player.connect();
    });
  });

  connectToPlayer = async (device_id) => {
    // get current access token
    // TODO: error handling
    let access_token = await this.getOAuthToken();
    // call connect to device endpoint
    return Axios.put(
      `https://api.spotify.com/v1/me/player`,
      {
        device_ids: [device_id],
        play: false,
      },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${access_token}`,
        },
      }
    );
  };

  /**
   * Disconnect player
   */
  disconnectPlayer = action(() => {
    this.player.disconnect();
    this.player = undefined;
  });

  /**
   * Get spotify OAuth token
   */
  getOAuthToken = action(async () => {
    // if there is an access token already and it hasn't expired then return that
    if (this.access_token && Date.now() < this.expires_at) {
      return this.access_token;
    }

    // if localStorage doesn't have an access token then go get it
    if (!window.localStorage.getItem("spotify:refresh_token")) {
      // TODO: show a warning modal. that there will be a redirect to login
      this.goAuth(window.location.pathname);
      return;
    }

    // if there is a refresh token and access token expired then get a new token
    //  TODO: error handling
    await this.refreshAccessToken();
    // return access token
    return this.access_token;
  });

  /**
   * Gets access token based on authorization code in spotify auth callback.
   * Used by AuthRedirect component.
   *
   * @param {string} code authorization code
   */
  getToken = action(async (code) => {
    // url params
    const postData = {
      client_id: CLIENT_ID,
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: window.sessionStorage.getItem("hashKey"),
    };
    const form = new URLSearchParams();
    for (let key in postData) {
      form.append(key, postData[key]);
    }

    // go get token
    // TODO: error handling
    const res = await Axios.post(
      "https://accounts.spotify.com/api/token",
      form
    );
    window.localStorage.setItem(
      "spotify:refresh_token",
      res.data.refresh_token
    );

    // set expire_at
    this.expires_at = Date.now() + res.data.expires_in * 1000;
  });

  /**
   * Refreshes access token in state using refresh token in localStorage
   */
  refreshAccessToken = action(async () => {
    // url params
    let postData = {
      client_id: CLIENT_ID,
      grant_type: "refresh_token",
      refresh_token: window.localStorage.getItem("spotify:refresh_token"),
    };
    let form = new URLSearchParams();
    for (let key in postData) {
      form.append(key, postData[key]);
    }
    try {
      // send request
      let res = await Axios.post(
        "https://accounts.spotify.com/api/token",
        form
      );
      window.localStorage.setItem(
        "spotify:refresh_token",
        res.data.refresh_token
      );
      this.access_token = res.data.access_token;
      this.expires_at = Date.now() + res.data.expires_in * 1000;
    } catch (e) {
      // TODO: error handling
      console.log(e.response.data);
      if (e.response.data.error_description === "Refresh token revoked") {
        this.goAuth(window.location.pathname);
      }
    }
  });

  /**
   * redirects to spotify auth endpoint
   *
   * @param {string} redirectTo where to return to after auth
   */
  goAuth = async (redirectTo) => {
    // save redirect path in sessionStorage
    window.sessionStorage.setItem("redirectTo", redirectTo);
    // create hash key and hash for PKCE
    let hash = await getVerifierAndChallenge(128);

    // set hashkey in sessionStorage
    window.sessionStorage.setItem("hashKey", hash[0]);
    // redirect to spotify
    window.location.href = `https://accounts.spotify.com/authorize?client_id=${CLIENT_ID}&response_type=code&redirect_uri=${encodeURIComponent(
      REDIRECT_URI
    )}&scope=streaming%20user-read-email%20user-read-private%20user-modify-playback-state&code_challenge_method=S256&code_challenge=${
      hash[1]
      }`;
  };
}

export async function getVerifierAndChallenge(len) {
  const validChars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let array = new Uint8Array(len);
  window.crypto.getRandomValues(array);
  array = array.map((x) => validChars.charCodeAt(x % validChars.length));
  const randomState = String.fromCharCode.apply(null, array);
  const hashedState = await pkce_challenge_from_verifier(randomState);

  return [randomState, hashedState];
}

window.crypto2 = crypto;
function sha256(plain) {
  // returns promise ArrayBuffer
  const encoder = new TextEncoder();
  const data = encoder.encode(plain);
  return crypto.createHash("sha256").update(data).digest();
}

function base64urlencode(a) {
  // Convert the ArrayBuffer to string using Uint8 array.
  // btoa takes chars from 0-255 and base64 encodes.
  // Then convert the base64 encoded to base64url encoded.
  // (replace + with -, replace / with _, trim trailing =)
  return btoa(String.fromCharCode.apply(null, new Uint8Array(a)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function pkce_challenge_from_verifier(v) {
  let hashed = await sha256(v);
  let base64encoded = base64urlencode(hashed);
  return base64encoded;
}
