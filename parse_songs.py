import os

def main():
    seen_artists = set()
    for filename in os.listdir("data"):
        try:
            with open("data/" + filename, "r", encoding='utf-8') as f:
                song = f.read()
                idx = song.find("id")
                #print(song[idx+6: idx+28])
                seen_artists.add(song[idx+6: idx+28])
                f.close()
        except:
            print("Failed on song: " + filename)
    
    with open("seen_artists.txt", "w", encoding="utf-8") as f:
        f.write(str(seen_artists))
        print("Wrote " + str(len(seen_artists)) + " artists to disk")
        f.close()

if __name__ == "__main__":
    main()