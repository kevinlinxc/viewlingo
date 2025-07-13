import requests
from datetime import datetime

def get_words_for_today(api_url="https://7ae419dac31f.ngrok-free.app/words"):
    today = datetime.now().strftime("%Y-%m-%d")
    response = requests.get(api_url, params={"date": today})
    response.raise_for_status()
    words = response.json()
    # Remove the 'picture' key from each word entry
    for word in words:
        word.pop('picture', None)
    return words

if __name__ == "__main__":
    words = get_words_for_today()
    print("Words for today (no images):")
    for word in words:
        print(word)
