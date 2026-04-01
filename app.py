import os
import uuid
import json
from flask import Flask, request, jsonify, send_from_directory, Response, stream_with_context
from flask_cors import CORS
from google import genai
from dotenv import load_dotenv
from pypdf import PdfReader

# Load environment variables from .env file
load_dotenv()

app = Flask(__name__)
CORS(app, resources={r"/api/*": {"origins": "*"}}) # Full CORS access for API routes

# Initialize global memory for multiple chat threads
# Format: { "thread_id": { "title": str, "history": list, "chat_session": genai.Chat, "model": str } }
threads = {}

# Get the API key from environment
API_KEY = os.environ.get('GEMINI_API_KEY', '')
DEFAULT_MODEL = 'gemini-2.5-flash'

# Initialize the Gemini client with explicit API key
try:
    client = genai.Client(api_key=API_KEY)
    print("Gemini Client Initialized Successfully")
except Exception as e:
    print(f"Failed to initialize Gemini Client: {e}")
    client = None

# Global System Instruction to force the AI to act as a Frontend Designer
SYSTEM_INSTRUCTION = """
You are 'perplexity.ai', a world-class Senior Frontend Architect and Creative Technologist specializing in premium user experiences. 
Your goal is to help the user build production-grade, aesthetically stunning web applications. 

DESIGN & TECHNICAL PRINCIPLES:
- **Aesthetics First**: Prioritize high-end dark modes, glassmorphism, and fluid animations.
- **Modern Tech Stack**: Prefer Vanilla CSS (with modern features like Container Queries, Grid, and HSL variables) and ES6+ JavaScript.
- **Atomic Design**: Structure code into reusable, logic-decoupled components.
- **Performance**: Optimize for Core Web Vitals (LCP, CLS).
- **Accessibility**: Ensure every component follows WCAG 2.1 guidelines (ARIA, semantic HTML).

RESPONSE GUIDELINES:
- Be concise, authoritative, and helpful.
- When provide code, ensure it is complete and 'copypaste-ready'.
- Always explain the 'why' behind your design choices (Design Rationale).
- If the user asks for a feature, suggest a 'premium' enhancement (e.g., adding a subtle hover effect or a loading skeleton).

CITATION FORMAT:
- Cite key design patterns or documentation like this: [1], [2].
"""

def create_new_thread(model_id=DEFAULT_MODEL):
    """Helper to generate a new thread ID and start a fresh Gemini context."""
    thread_id = str(uuid.uuid4())
    chat_session = None
    if client:
        try:
            # We pass the system instruction here so Gemini knows its persona
            chat_session = client.chats.create(
                model=model_id,
                config={'system_instruction': SYSTEM_INSTRUCTION}
            )
        except Exception as e:
            print(f"Error creating chat session: {e}")
            
    threads[thread_id] = {
        "title": "New Chat",
        "history": [],
        "chat_session": chat_session,
        "model": model_id,
        "pdf_text": None,
        "pdf_name": None
    }
    return thread_id

@app.route('/')
def index():
    """Serve the frontend HTML automatically."""
    return send_from_directory('.', 'index.html')

@app.route('/<path:path>')
def serve_static(path):
    """Serve CSS, JS, and other static files."""
    return send_from_directory('.', path)

@app.route('/api/new_chat', methods=['POST'])
def new_chat():
    """Endpoint to trigger a fresh multi-thread context manually."""
    thread_id = create_new_thread()
    return jsonify({'thread_id': thread_id})

@app.route('/api/history', methods=['GET'])
def get_history():
    """Return all threads for sidebar, plus specific history if requested."""
    thread_id = request.args.get('thread_id')
    
    # Sort threads for sidebar (newest first based on creation if we tracked time, but dict order is fine for prototype)
    # We will format the list so the UI can draw the sidebar
    all_threads = [{"id": tid, "title": data["title"]} for tid, data in reversed(threads.items())]
    
    if thread_id and thread_id in threads:
        history = threads[thread_id]["history"]
        return jsonify({'threads': all_threads, 'history': history, 'current_thread': thread_id})
    else:
        # If no specific thread is given, just return the list of available threads
        return jsonify({'threads': all_threads})

@app.route('/api/chat', methods=['POST'])
def chat():
    data = request.json
    prompt = data.get('prompt')
    thread_id = data.get('thread_id')
    model_id = data.get('model_id', DEFAULT_MODEL)

    # Auto-create thread if missing or invalid
    if not thread_id or thread_id not in threads:
        thread_id = create_new_thread(model_id)

    thread_data = threads[thread_id]
    chat_session = thread_data["chat_session"]

    if not chat_session:
        # Try to recreate the session
        try:
            chat_session = client.chats.create(
                model=model_id,
                config={'system_instruction': SYSTEM_INSTRUCTION}
            )
            thread_data["chat_session"] = chat_session
        except Exception as e:
            print(f"Error creating chat session: {e}")
            return jsonify({'error': f'Failed to initialize session: {e}'}), 500

    if not prompt:
        return jsonify({'error': 'Prompt is required'}), 400

    print(f"Received prompt on thread {thread_id}: {prompt}")

    # Generate title automatically from the first prompt
    if len(thread_data["history"]) == 0:
        # Truncate for a clean sidebar title
        thread_data["title"] = prompt[:25] + '...' if len(prompt) > 25 else prompt

    # 1. Update our local memory list for the UI (User Prompt)
    thread_data["history"].append({'role': 'user', 'text': prompt})

    try:
        # 2. Add prompt to Gemini's actual chat session and request answer
        response = chat_session.send_message(prompt)
        
        # 3. Carefully check if the model provided a text response (Safety or Error)
        response_text = None
        try:
            response_text = response.text
        except Exception:
            pass
            
        if not response_text:
            error_msg = "The model did not provide a text response. It might have been blocked due to safety filters."
            if hasattr(response, 'candidates') and response.candidates:
                # Potential cause: Safety or logic problem
                print(f"Response Blocked: {response.candidates[0].finish_reason}")
            return jsonify({'error': error_msg}), 400

        # 4. Save model response to history
        thread_data["history"].append({'role': 'model', 'text': response_text})

        # 5. Mock Sources (with PDF if present)
        sources = [
            {"title": "MDN Web Docs: CSS Glassmorphism", "url": "https://developer.mozilla.org"},
            {"title": "Lucide Icons", "url": "https://lucide.dev"}
        ]
        
        if thread_data.get("pdf_name"):
            sources.insert(0, {"title": f"Uploaded: {thread_data['pdf_name']}", "url": "#"})

        return jsonify({
            'response': response_text, 
            'title': thread_data["title"],
            'sources': sources,
            'thread_id': thread_id
        })
            
    except Exception as e:
        error_str = str(e)
        status_code = 500
        
        # SPECIFIC QUOTA ERROR HANDLING (429)
        if "429" in error_str or "RESOURCE_EXHAUSTED" in error_str:
            error_str = "Gemini Quota Exceeded (Free Tier limit: 5 requests per minute). Please wait about 60 seconds before trying again."
            status_code = 429
            
        print(f"Error in chat thread {thread_id}: {error_str}")
        return jsonify({'error': error_str}), status_code

@app.route('/api/chat_stream', methods=['POST'])
def chat_stream():
    """Streaming version of the chat endpoint."""
    data = request.json
    prompt = data.get('prompt')
    thread_id = data.get('thread_id')
    model_id = data.get('model_id', DEFAULT_MODEL)

    if not prompt:
        return jsonify({'error': 'Prompt is required'}), 400

    if not thread_id or thread_id not in threads:
        thread_id = create_new_thread(model_id)

    thread_data = threads[thread_id]
    chat_session = thread_data["chat_session"]

    if not chat_session:
        try:
            chat_session = client.chats.create(
                model=model_id,
                config={'system_instruction': SYSTEM_INSTRUCTION}
            )
            thread_data["chat_session"] = chat_session
        except Exception as e:
            return jsonify({'error': f'Failed to init session: {e}'}), 500

    if len(thread_data["history"]) == 0:
        thread_data["title"] = prompt[:25] + '...' if len(prompt) > 25 else prompt

    thread_data["history"].append({'role': 'user', 'text': prompt})

    def generate():
        full_response = []
        try:
            # Yield metadata first (thread_id, title, etc.)
            yield f"data: {{\"type\": \"start\", \"thread_id\": \"{thread_id}\", \"title\": \"{thread_data['title']}\"}}\n\n"
            
            # If there's a PDF attached to this thread, include it in the prompt as context
            if thread_data["pdf_text"]:
                prompt = f"--- PDF CONTEXT START ---\n{thread_data['pdf_text']}\n--- PDF CONTEXT END ---\n\nTHE USER QUESTION IS: {prompt}"

            # Send message stream
            response_stream = chat_session.send_message_stream(prompt)
            
            for chunk in response_stream:
                if chunk.text:
                    full_response.append(chunk.text)
                    chunk_json = json.dumps({"type": "chunk", "content": chunk.text})
                    yield f"data: {chunk_json}\n\n"
            
            # After stream finishes, save to history
            final_text = "".join(full_response)
            thread_data["history"].append({'role': 'model', 'text': final_text})
            
            # Yield final packet with PDF citation if available
            sources = [
                {"title": "MDN Web Docs: CSS Glassmorphism", "url": "https://developer.mozilla.org"},
                {"title": "Lucide Icons", "url": "https://lucide.dev"}
            ]
            if thread_data["pdf_name"]:
                sources.insert(0, {"title": f"Uploaded: {thread_data['pdf_name']}", "url": "#"})

            yield f"data: {json.dumps({'type': 'done', 'sources': sources})}\n\n"
            
        except Exception as e:
            err_msg = str(e)
            if "429" in err_msg or "RESOURCE_EXHAUSTED" in err_msg:
                err_msg = "Quota Exceeded. Please wait 60s."
            yield f"data: {json.dumps({'type': 'error', 'message': err_msg})}\n\n"

    return Response(stream_with_context(generate()), mimetype='text/event-stream')

@app.route('/api/upload', methods=['POST'])
def upload_file():
    """Endpoint to handle PDF uploads and extract text via pypdf."""
    if 'file' not in request.files:
        return jsonify({'error': 'No file part'}), 400
    
    file = request.files['file']
    thread_id = request.form.get('thread_id')

    if file.filename == '':
        return jsonify({'error': 'No selected file'}), 400
    
    if not thread_id or thread_id not in threads:
        return jsonify({'error': 'Invalid thread ID'}), 400

    if file and file.filename.lower().endswith('.pdf'):
        try:
            reader = PdfReader(file)
            text = ""
            for i, page in enumerate(reader.pages):
                extracted = page.extract_text()
                if extracted:
                    text += f"\n--- Page {i+1} ---\n{extracted}"
            
            if not text.strip():
                return jsonify({'error': 'Could not extract text from the PDF. It might be a scanned image (OCR not supported).'}), 400
                
            threads[thread_id]["pdf_text"] = text
            threads[thread_id]["pdf_name"] = file.filename
            
            return jsonify({
                'message': 'PDF analyzed successfully',
                'filename': file.filename,
                'pageCount': len(reader.pages)
            })
        except Exception as e:
            print(f"Error processing PDF: {e}")
            return jsonify({'error': f'Internal processing error: {e}'}), 500
    else:
        return jsonify({'error': 'Only PDF files are supported.'}), 400

if __name__ == '__main__':
    print("Starting Multi-Threaded Flask Backend...")
    # Create an initial default thread so the app has one on boot
    create_new_thread()
    app.run(debug=True, host='0.0.0.0', port=5000)
