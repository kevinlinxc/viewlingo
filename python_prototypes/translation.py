from google.generativeai import configure, GenerativeModel
from dotenv import load_dotenv
import os
load_dotenv()


# Replace with your API key
configure(api_key=os.environ["GEMINI_API_KEY"])

model = GenerativeModel('gemini-2.5-flash') # Or any other Gemini model

format_prompt = '{"characters": "", "anglicized": ""}'
response = model.generate_content(f"What is `friend` in Mandarin Chinese? Answer in this JSON format: {format_prompt}, with no other formatting or padding",)
print(response.text)