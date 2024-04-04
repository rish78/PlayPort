import dotenv from 'dotenv';
dotenv.config();
import express from 'express';
import open from 'open';
import axios from 'axios';
import { google } from 'googleapis';
import readline from 'readline';

const app = express();
const port = 3000;
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

let oauth2Client;
let spotifyClientId = process.env.SPOTIFY_CLIENT_ID;
let spotifyClientSecret = process.env.SPOTIFY_CLIENT_SECRET;
let accessTokenSpotify;
let spotifyPlaylists = [];
let trackDetails = [];
let playlistName;
let errorTracks = [];

async function setupOAuthClients() {
  oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `http://localhost:${port}/callback-youtube`
  );

  spotifyClientId = process.env.SPOTIFY_CLIENT_ID;
  spotifyClientSecret = process.env.SPOTIFY_CLIENT_SECRET;
}

function configureExpressRoutes() {
  app.get('/login-youtube', initiateYouTubeLogin);
  app.get('/callback-youtube', handleYouTubeCallback);
  app.get('/login-spotify', initiateSpotifyLogin);
  app.get('/callback', handleSpotifyCallback);
}

async function initiateYouTubeLogin(req, res) {
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/youtube'],
  });
  open(authUrl);
  res.end();
}

// These functions were outlined but not detailed in the previous section.

async function handleYouTubeCallback(req, res) {
    const { code } = req.query;
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);
    
    console.log("Authenticated with YouTube. You can close this tab.");
    res.send("Authenticated with YouTube. You can close this tab.");
  
    // Now, fetch and display YouTube Music playlists
    await fetchYouTubeMusicPlaylists();
    
    // After YouTube Music flow, prompt user to start Spotify login via the console
    console.log("Proceed with Spotify authentication by navigating to http://localhost:3000/login-spotify");
  }
  
  async function fetchYouTubeMusicPlaylists() {
    const youtube = google.youtube({
      version: 'v3',
      auth: oauth2Client,
    });
  
    try {
      const response = await youtube.playlists.list({
        part: 'snippet',
        mine: true,
      });
      console.log("Your YouTube Music Playlists:");
      response.data.items.forEach((playlist, index) => {
        console.log(`${index + 1}. ${playlist.snippet.title}`);
      });
    } catch (error) {
      console.error('Error fetching YouTube Music playlists:', error);
    }
  }
  
  async function initiateSpotifyLogin(req, res) {
    const scopes = 'user-read-private user-read-email playlist-read-private';
    const authUrl = 'https://accounts.spotify.com/authorize' +
      '?response_type=code' +
      '&client_id=' + spotifyClientId +
      '&scope=' + encodeURIComponent(scopes) +
      '&redirect_uri=' + encodeURIComponent(`http://localhost:${port}/callback`);
    
    open(authUrl); // Automatically opens the browser to the Spotify login page
    res.end();
  }
  
  async function handleSpotifyCallback(req, res) {
    const code = req.query.code || null;
  
    try {
      const response = await axios({
        method: 'post',
        url: 'https://accounts.spotify.com/api/token',
        data: `grant_type=authorization_code&code=${code}&redirect_uri=${encodeURIComponent(`http://localhost:${port}/callback`)}`,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': 'Basic ' + Buffer.from(`${spotifyClientId}:${spotifyClientSecret}`).toString('base64'),
        },
      });
  
      accessTokenSpotify = response.data.access_token;
      console.log("Authenticated with Spotify. You can close this tab.");
      res.send("Authenticated with Spotify. You can close this tab.");
  
      // Fetch and display Spotify playlists
      await fetchSpotifyPlaylists();
    } catch (error) {
      console.error('Error during Spotify authentication:', error);
      res.send('Error during authentication.');
    }
  }
  
  async function fetchSpotifyPlaylists() {
    try {
      const response = await axios.get('https://api.spotify.com/v1/me/playlists', {
        headers: {
          'Authorization': `Bearer ${accessTokenSpotify}`,
        },
      });
  
      console.log("Your Spotify Playlists:");
      spotifyPlaylists = response.data.items;
      spotifyPlaylists.forEach((playlist, index) => {
        console.log(`${index + 1}. ${playlist.name}`);
      });
  
      // Prompt user to select a Spotify playlist
      selectSpotifyPlaylist();
    } catch (error) {
      console.error('Error fetching Spotify playlists:', error);
    }
  }
  
  function selectSpotifyPlaylist() {
    rl.question('Enter the number of the Spotify playlist to view its tracks: ', async (index) => {
      const playlistIndex = parseInt(index, 10) - 1;
      if (playlistIndex >= 0 && playlistIndex < spotifyPlaylists.length) {
        const selectedPlaylist = spotifyPlaylists[playlistIndex];
        console.log(`Fetching tracks for playlist: ${selectedPlaylist.name}`);
        playlistName = selectedPlaylist.name;
        await fetchPlaylistTracks(selectedPlaylist.id);
      } else {
        console.log('Invalid selection. Please try again.');
        selectSpotifyPlaylist(); // Prompt again if selection is invalid
      }
    });
  }
  
  async function fetchPlaylistTracks(playlistId) {
    try {
      const tracksResponse = await axios.get(`https://api.spotify.com/v1/playlists/${playlistId}/tracks`, {
        headers: {
          'Authorization': `Bearer ${accessTokenSpotify}`,
        },
      });
  
      tracksResponse.data.items.forEach(item => {
        const track = item.track;
        const trackInfo = {
            name: track.name,
            album: track.album.name,
            artists: track.artists.map(artist => artist.name).join(", ") // Combining all artist names
        };
        trackDetails.push(trackInfo);
    });

    console.log('Tracks in the selected playlist:', trackDetails);
    await transferSpotifyPlaylistToYouTube(oauth2Client, trackDetails);
    } catch (error) {
      console.error('Error fetching playlist tracks:', error);
    } finally {
      rl.close();
    }
  }

  async function transferSpotifyPlaylistToYouTube(authClient, trackDetailsArray) {
    const playlistId = await createYouTubePlaylist(authClient, "My Spotify Playlist on YouTube");
    if (!playlistId) {
        console.log("Failed to create YouTube playlist.");
        return;
    }

    for (const trackDetails of trackDetailsArray) {
        const videoId = await searchYouTubeForTrack(authClient, trackDetails);
        if (videoId) {
            await addTrackToPlaylist(authClient, playlistId, videoId, trackDetails);
        } else {
            console.log(`Track not found on YouTube: ${trackDetails.name}`);
        }
    }

    let total = trackDetailsArray.length;
    let errors = errorTracks.length;
    console.log(`Playlist transfer complete. ${total - errors} tracks added to YouTube playlist.`);
    if (errors > 0) {
        console.log(`Error adding the following tracks to YouTube playlist.`);
        errorTracks.forEach(track => {
            console.log(track.name);
        });
    }
}

  async function createYouTubePlaylist(authClient) {
    const youtube = google.youtube({version: 'v3', auth: authClient});
    console.log("Creating playlist...")
    try {
        const response = await youtube.playlists.insert({
            part: 'snippet,status',
            requestBody: {
                snippet: {
                    title: `Imported from Spotify: ${playlistName}`,
                    description: 'Created via my app',
                },
                status: {
                    privacyStatus: 'public', // or 'public', 'unlisted'
                },
            },
        });
        console.log(`Playlist created: ${response.data.snippet.title}`);
        return response.data.id; // Return the created playlist ID for later use
    } catch (error) {
        console.error('Failed to create YouTube playlist:', error);
    }
}

async function searchYouTubeForTrack(authClient, trackDetails) {
    const youtube = google.youtube({version: 'v3', auth: authClient});
    try {
        const response = await youtube.search.list({
            part: 'snippet',
            q: `${trackDetails.name} ${trackDetails.album} ${trackDetails.artists}`,
            maxResults: 1,
            type: 'video',
        });
        if (response.data.items.length > 0) {
            return response.data.items[0].id.videoId; // Return the first video ID found
        } else {
            console.log('No results found for:', trackDetails);
            errorTracks.push(trackDetails);
            return null;
        }
    } catch (error) {
        console.error('Search API Error:', error);
    }
}

async function addTrackToPlaylist(authClient, playlistId, videoId, trackDetails) {
    const youtube = google.youtube({version: 'v3', auth: authClient});
    try {
        await youtube.playlistItems.insert({
            part: 'snippet',
            requestBody: {
                snippet: {
                    playlistId: playlistId,
                    resourceId: {
                        kind: 'youtube#video',
                        videoId: videoId,
                    },
                },
            },
        });
        console.log(`Added video ${videoId} to playlist ${playlistId}`);
    } catch (error) {
        console.log(`Could not add track ${trackDetails.name} to playlist.`)
        errorTracks.push(trackDetails);
        console.error('Failed to add track to playlist:', error);
    }
}




  async function main() {
    await setupOAuthClients();
    configureExpressRoutes();
  
    app.listen(port, () => {
      console.log(`Listening on port ${port}.`);
      askForYouTubeLogin();
    });
  }

  function askForYouTubeLogin() {
    console.log(`To start, please authenticate with YouTube by visiting: http://localhost:${port}/login-youtube`);
}
  
  main().catch(console.error);