import spotipy
from spotipy.oauth2 import SpotifyClientCredentials
import re, sys, os.path

client_id = 'ee31bafc26514072996d72e1b8387059'
client_secret = '5f561d59dcb14de7806bf2480cd7e8f6'
spotify = spotipy.Spotify(client_credentials_manager=SpotifyClientCredentials())
WRITE_TO_DISK = True


manually_seen_artists = {
            # '06HL4z0CvFAxyc27GXpf02', # Taylor
            # '4q3ewBCX7sLwd24euuV69X', # Bad Bunny
            # '1Xyo4u8uXC1ZmMpatF05PJ', # The Weeknd
            # '3TVXtAsR1Inumwj472S9r4', # Drake
            # '5YGY8feqx7naU7z4HrwZM6', # Miley Cyrus
            # '6KImCVD70vtIoJWnq6nGn3', # Harry Styles
            # '0C8ZW7ezQVs4URX5aX7Kqx', # Selena Gomez
            # '6vWDO969PvNqNYHIOW5v0m', # Beyonce
            # '2RQXRUsr4IW1f3mKyKsy4B' # Noah Kahan   
            }



def get_songs_by_artist(artist_id: str, write: bool):
    songs_written = 0
    uri = 'spotify:artist:' + artist_id
    #print(uri)

    try:
        results = spotify.artist_albums(uri, album_type='album')
    except: 
        print("Spotify failed with request: " + uri)
        return -1
    albums = results['items']
    while results['next']:
        results = spotify.next(results)
        albums.extend(results['items'])


    for album in albums:
        try:
            res = spotify.album_tracks(album['id'])
        except:
            print("Spotify failed with request for album: " + album['id'])
            return -1
        songs = res['items']
        while res['next']:
            res = spotify.next(res)
            songs.extend(res["items"])
        ids = [song['id'] for song in songs]
        
        try:
            feat_req = spotify.audio_features(ids)
        except:
            print("Spotify failed with features request")
            return -1
        for i in range(len(songs)):
            song = songs[i]
            if 'available_markets' in song.keys():
                del song['available_markets']
            song['features'] = feat_req[i]
            if (write):
                path = 'data/' + song['id']
                if not os.path.isfile(path):
                    with open(path, 'w', encoding="utf-8") as f:
                        f.seek(0)
                        f.write(str(song))
                        f.close()
                        songs_written += 1
            else:
                print(str(song))
    return songs_written

def read_artists(filename: str):
    with open(filename, 'r', encoding="utf-8") as f:
            f.seek(0)
            set_string = f.read()[1:-2]
            set_string = re.sub(",|'", "", set_string)
            seen_artists = set([item for item in set_string.split(" ") if item != '' and re.match("^[A-Za-z0-9]*$", item)])
            seen_artists = seen_artists.union(manually_seen_artists)
            f.close()
            return seen_artists

def find_related_artists(artist_id: str):
    related_artists = set()
    uri = 'spotify:artist:' + artist_id
    try:
        results = spotify.artist_related_artists(uri)
    except:
        print("Spotify failed with request: " + uri)
    artists = results['artists']
    for artist in artists:
        related_artists.add(artist["id"].strip())
    return related_artists

def exit(seen_artists: set, new_artists: set):
    
    with open("seen_artists.txt", "w", encoding="utf-8") as f:
        f.write(str(seen_artists))
        f.close()
    if new_artists:
        with open("new_artists.txt", "w", encoding="utf-8") as f:
            f.write(str(new_artists))
            f.close()
            
    print("Scraped and wrote " + str(songs_written) + " to disk")
    print("Ended with " + str(len(new_artists)) + " left to search and " + str(len(seen_artists)) + " searched")
    
    raise(SystemExit)

def main():
    songs_to_write = int(sys.argv[1])
    songs_written = 0
    new_artists = set(sys.argv[2:]).union(read_artists("new_artists.txt"))
    seen_artists = read_artists("seen_artists.txt")
    
    while new_artists and songs_written < songs_to_write:
        cur_artist = new_artists.pop()
        #print("Getting artist " + cur_artist)
        new_artists = new_artists.union(find_related_artists(cur_artist)).difference(seen_artists)
        
        exit_code = get_songs_by_artist(cur_artist, WRITE_TO_DISK)
        if (exit_code >= 0):
            songs_written += exit_code
        else:
            exit(seen_artists, new_artists)
            
        seen_artists.add(cur_artist)
    
    exit(seen_artists, new_artists)


if __name__ == "__main__":
    main()



