import React from "react";
import * as auth from "./SpotifyAuth";
import * as SessionAuth from "./SessionManager";
import * as firebase from "firebase/app";
import axios from "axios";
import { Player } from "./Player";
import Layout from "./Layout";

export default class HostPlayer extends React.Component {
  state = {
    position: 0,
    duration: 0,
    connected: false,
    uri: "",
    playing: false,
    coverArtURL: "",
    title: "",
    artists: [],
    album: "",
    device_id: "",
    volume: 0.2,
    hostConnected: false,
    loading: true,
    connections: 0,
    viewPlayer: false,
    psoCounter: 0,
    session_token: "",
  };

  setTokenRefreshInterval = () => {
    // refresh token
    this.refreshInterval = setInterval(
      SessionAuth.refreshToken,
      30 * 60 * 1000,
      [window.localStorage.getItem("pogify:token")]
    );
  };

  async publishUpdate(uri, position, playing) {
    this.retryCount = this.retryCount ?? 0;
    try {
      firebase.auth().signInAnonymously();
      await axios.post(
        "https://us-central1-pogify-database.cloudfunctions.net/postUpdate",
        {
          uri,
          position,
          playing,
          timestamp: Date.now(),
        },
        {
          headers: {
            Authorization:
              "Bearer " + window.localStorage.getItem("pogify:token"),
            "Content-Type": "application/json",
          },
        }
      );
      this.retryCount = null;
    } catch (e) {
      if (e.response) {
        if (e.response.status === 401) {
          // session expired modal or something
          return console.error("sessionExpired");
        }
      }
      if (this.retryCount < 3) {
        this.retryCount++;
        return setTimeout(this.publishUpdate, 100, [uri, position, playing]);
      } else {
        throw e;
      }
    }
  }

  connect = () => {
    this.player.addListener("ready", (e) => {
      console.log(e);
      this.connectToPlayer(e.device_id);
      this.setTokenRefreshInterval();
      console.log(window.sessionStorage.getItem("expires_at"));

      this.setState({
        device_id: e.device_id,
      });
    });
    this.player.addListener("not_ready", console.log);
    this.player.on("initialization_error", ({ message }) => {
      console.error("Failed to initialize", message);
    });
    this.player.on("authentication_error", ({ message }) => {
      console.error("Failed to authenticate", message);
    });
    this.player.on("account_error", ({ message }) => {
      console.error("Failed to validate Spotify account", message);
    });
    this.player.on("playback_error", ({ message }) => {
      console.error("Failed to perform playback", message);
    });
    this.player.connect();
  };

  initializePlayer = () => {
    this.player = new window.Spotify.Player({
      volume: 0.2,
      name: "Pogify Host",
      getOAuthToken: (callback) => {
        let token = window.sessionStorage.getItem("access_token");
        let refreshToken = window.sessionStorage.getItem("refresh_token");
        let expire = window.sessionStorage.getItem("expires_at");
        if (Date.now() > expire && refreshToken) {
          return auth
            .refreshToken(refreshToken)
            .then((data) => {
              this.setState({
                loggedIn: true,
              });
              callback(data.access_token);
            })
            .catch((e) => {
              if ((e.error_description = "Refresh Token Revoked")) {
                window.sessionStorage.removeItem("refresh_token");
                window.sessionStorage.removeItem("access_token");
                auth.goAuth(this.props.match.params.id);
              }
            });
        }

        if (token) {
          this.setState({
            loggedIn: true,
          });
          return callback(token);
        }
        let code = window.sessionStorage.getItem("code");
        if (code) {
          auth.getToken(code).then((data) => {
            window.sessionStorage.removeItem("code");
            console.log(data);
            this.setState({
              loggedIn: true,
            });
            callback(data.access_token);
          });
        } else {
          auth.goAuth(this.props.match.params.id);
        }
      },
    });
    this.player.on("player_state_changed", (data) => {
      console.log(data);
      if (this.state.psoCounter && !data) {
        // push disconnect update
        this.publishUpdate("", this.state.position, false);

        // show a modal and/or send a notification on disconnect
        alert(
          "Spotify disconnected. Check that you are connected to 'Pogify Host' on Spotify"
        );
      }
      if (data) {
        console.log("alksdfe", data);
        this.setState({
          playbackStateObj: data,
          position: data.position,
          psoCounter: this.state.psoCounter + 1,
        });
      }
    });
    this.setState({ loading: false });
  };

  connectToPlayer = (device_id) => {
    return axios
      .put(
        `https://api.spotify.com/v1/me/player`,
        {
          device_ids: [device_id || this.state.device_id],
          play: false,
        },
        {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${window.sessionStorage.getItem(
              "access_token"
            )}`,
          },
        }
      )
      .then(() => {
        this.setState({
          connected: true,
        });
      });
  };

  changeVolume = (e) => {
    this.player.setVolume(e.target.value);
    this.setState({
      volume: e.target.value,
    });
  };

  componentDidMount() {
    window.onbeforeunload = () => {
      this.publishUpdate("", this.state.position, false);
    };

    this.setState({
      session_token: window.localStorage.getItem("pogify:token"),
    });

    if (window.spotifyReady) {
      this.initializePlayer();
    } else {
      window.onSpotifyWebPlaybackSDKReady = this.initializePlayer;
    }
  }

  componentDidUpdate(
    _prevProps,
    { playbackStateObj: pPSO, psoCounter: ppsoC }
  ) {
    if (!pPSO) {
      return;
    }

    if (ppsoC !== this.state.psoCounter) {
      let {
        track_window: {
          current_track: { uri },
        },
        position,
        paused,
      } = this.state.playbackStateObj;
      this.publishUpdate(uri, position, !paused);

      if (pPSO.paused !== paused) {
        if (paused) {
          clearInterval(this.tickInterval);
        } else {
          this.tickInterval = setInterval(() => {
            this.setState({
              position: this.state.position + 1000,
            });
          }, 1000);
        }
      }
    }
  }

  componentWillUnmount() {
    this.publishUpdate("", this.state.position, false);
    window.onbeforeunload = null;
    this.player.disconnect();
    clearInterval(this.refreshInterval);
  }

  render() {
    if (Date.now() > window.sessionStorage.getItem("expires_at")) {
      return (
        <Layout>
          <button onClick={this.connect}>Login with Spotify</button>
        </Layout>
      );
    }

    if (this.state.loading) {
      return (
        <Layout>
          <div>Loading</div>
        </Layout>
      );
    }

    if (!this.state.playbackStateObj) {
      return (
        <Layout>
          <button onClick={this.connect}>Start Session</button>
        </Layout>
      );
    }

    let { paused, duration } = this.state.playbackStateObj;
    let { volume } = this.state;
    let position = this.state.position;
    let coverArtURL = this.state.playbackStateObj.track_window.current_track
      .album.images[0].url;
    let album = this.state.playbackStateObj.track_window.current_track.album
      .name;
    let artists = this.state.playbackStateObj.track_window.current_track
      .artists;
    let title = this.state.playbackStateObj.track_window.current_track.name;

    return (
      <>
        <Player
          position={position / 1000}
          duration={duration / 1000}
          coverArtURL={coverArtURL}
          album={album}
          title={title}
          artists={artists}
          togglePlay={() => this.player.togglePlay()}
          playing={!paused}
          volume={volume}
          changeVolume={this.changeVolume}
        />
        <div
          style={{
            width: 300,
            textAlign: "center",
            backgroundColor: "#424242",
            borderRadius: 10,
            padding: 30,
            marginTop: 10,
          }}
        >
          You are the host of this session. <br />
          Share the url below to listen with others:
          <div style={{ margin: 10 }}>
            <input type="text" readOnly value={window.location.href} />
          </div>
          Use Spotify as you usually would. <br />
          Your music is being played in this browser window. Don't close this
          window. <br />
          {this.state.connections} in this session.
        </div>
      </>
    );
  }
}
