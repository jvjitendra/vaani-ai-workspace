import pytest
import os
import sys
from pathlib import Path

# Add backend to sys.path
backend_dir = Path(__file__).resolve().parent.parent / "backend"
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

import brain_db
import tools
from app import app

@pytest.fixture
def client():
    app.config["TESTING"] = True
    with app.test_client() as client:
        yield client

def test_health_endpoint(client):
    res = client.get("/api/health")
    assert res.status_code == 200
    data = res.get_json()
    assert data["ok"] is True
    assert "version" in data
    assert "groq_configured" in data
    assert "time_ist" in data

def test_time_endpoint_ist(client):
    res = client.get("/api/time")
    assert res.status_code == 200
    data = res.get_json()
    assert data["ok"] is True
    assert "time" in data or "formatted" in data
    assert "Asia/Kolkata" in data.get("timezone", "")

def test_time_endpoint_ohio(client):
    res = client.get("/api/time?city=Ohio")
    assert res.status_code == 200
    data = res.get_json()
    assert data["ok"] is True
    assert data.get("timezone") == "America/New_York"
    assert data.get("is_india") is False
    assert "behind India (IST)" in data.get("time_diff_from_ist", "")

def test_live_time_engine_ohio():
    t_data = tools.fetch_real_time("Ohio")
    assert t_data.get("ok") is True
    assert t_data.get("timezone") == "America/New_York"
    assert t_data.get("is_india") is False
    assert "behind India (IST)" in t_data.get("time_diff_from_ist", "")
    assert t_data.get("time_12h") is not None
    assert t_data.get("date") is not None

def test_live_time_engine_india_no_redundant_diff():
    # Mandatory rule: inside India, do not show redundant India comparison
    t_data = tools.fetch_real_time("Ranchi")
    assert t_data.get("ok") is True
    assert t_data.get("timezone") == "Asia/Kolkata"
    assert t_data.get("is_india") is True
    assert t_data.get("time_diff_from_ist") is None

def test_live_time_engine_london():
    t_data = tools.fetch_real_time("London")
    assert t_data.get("ok") is True
    assert t_data.get("timezone") == "Europe/London"
    assert t_data.get("is_india") is False
    assert "behind India (IST)" in t_data.get("time_diff_from_ist", "")

def test_models_endpoint(client):
    res = client.get("/api/models")
    assert res.status_code == 200
    data = res.get_json()
    assert data["ok"] is True
    assert "models" in data
    assert "vision" in data

def test_brain_db_memory_operations():
    mem_text = "Pytest: Jitendra is an engineer building advanced AI workspace assistants"
    saved = brain_db.save_memory(mem_text, category="test_profile", source="test_runner")
    assert saved is not None
    mem_id = saved.get("id")
    assert mem_id is not None

    all_mem = brain_db.list_memories()
    assert any(m["id"] == mem_id for m in all_mem)

    results = brain_db.search_memories("Jitendra engineer", limit=5)
    assert len(results) > 0
    assert any(m["id"] == mem_id for m in results)

    deleted = brain_db.delete_memory(mem_id)
    assert deleted is True

def test_brain_db_chat_history_and_conversations():
    test_cid = "test_conversation_pytest_123"
    brain_db.save_chat_message(test_cid, "user", "What is the capital of France?", title="Capital Query")
    brain_db.save_chat_message(test_cid, "assistant", "The capital of France is Paris.", title="Capital Query")

    convos = brain_db.list_conversations(limit=10)
    assert any(c["id"] == test_cid for c in convos)

    messages = brain_db.get_conversation_messages(test_cid)
    assert len(messages) >= 2
    assert messages[0]["content"] == "What is the capital of France?"
    assert messages[1]["content"] == "The capital of France is Paris."

def test_weather_chandigarh():
    weather_data = tools.fetch_real_weather("Chandigarh")
    assert weather_data.get("ok") is True
    assert weather_data.get("city") == "Chandigarh"
    assert weather_data.get("temperature_c") is not None

def test_weather_kharar():
    weather_data = tools.fetch_real_weather("Kharar")
    assert weather_data.get("ok") is True
    assert weather_data.get("city") == "Kharar"
    assert weather_data.get("temperature_c") is not None

def test_weather_ohio():
    weather_data = tools.fetch_real_weather("Ohio")
    assert weather_data.get("ok") is True
    assert "Ohio" in weather_data.get("city") or "Columbus" in weather_data.get("city")
    assert weather_data.get("temperature_c") is not None
    assert weather_data.get("temperature_f") is not None

def test_weather_units_c_and_f():
    weather_data = tools.fetch_real_weather("Columbus, Ohio")
    assert weather_data.get("ok") is True
    assert weather_data.get("temperature_c") is not None
    assert weather_data.get("temperature_f") is not None

def test_weather_ohio_query_routing():
    query = "again the samething ohio jo america me hai uska ky ni bata rha hia yte weather"
    tool_res = tools.route_and_execute_tools(query)
    assert any("weather" in t for t in tool_res["executed_tools"])
    assert "Ohio" in tool_res["evidence_block"]

def test_route_and_execute_combined_weather_and_time():
    query = "London ka current weather aur India se time difference bata"
    tool_res = tools.route_and_execute_tools(query)
    assert any("weather" in t for t in tool_res["executed_tools"])
    assert any("time" in t for t in tool_res["executed_tools"])
    assert "London" in tool_res["evidence_block"]
    assert "India (IST)" in tool_res["evidence_block"]

def test_route_and_execute_web_research():
    query = "What is happening in Ohio today?"
    tool_res = tools.route_and_execute_tools(query)
    assert any("web_research" in t for t in tool_res["executed_tools"])
    assert "VERIFIED MULTI-SOURCE WEB RESEARCH" in tool_res["evidence_block"]

def test_math_tool():
    res = tools.evaluate_math("12 * 12 + 10")
    assert res.get("ok") is True
    assert res.get("result") == 154

def test_brain_library_indexing():
    sample_text = "TaskFlow is a full-stack task manager application developed by Jitendra. DevPilot is an automated software engineering agent."
    doc = brain_db.index_document(
        filename="test_ecosystem_doc.txt",
        file_bytes=sample_text.encode("utf-8"),
        file_type="text/plain",
        extracted_text=sample_text
    )
    assert doc is not None
    doc_id = doc.get("id")

    search_hits = brain_db.search_library("TaskFlow", limit=3)
    assert len(search_hits) > 0
    assert any(h["doc_id"] == doc_id for h in search_hits)

    deleted = brain_db.delete_library_document(doc_id)
    assert deleted is True

def test_taskflow_fetch_tasks():
    res = tools.fetch_taskflow_tasks(limit=5)
    assert res.get("ok") is True
    assert "tasks" in res
    assert isinstance(res["tasks"], list)

def test_taskflow_create_and_complete_task():
    create_res = tools.create_taskflow_task(
        title="Vaani Bridge Integration Test Task",
        description="Automated unit test task created via Vaani executive brain",
        priority="high"
    )
    assert create_res.get("ok") is True
    task_id = create_res.get("task_id")
    assert task_id is not None
    assert create_res.get("priority") == "high"

    # Complete it
    comp_res = tools.complete_taskflow_task(str(task_id))
    assert comp_res.get("ok") is True

def test_vaani_morning_briefing_engine():
    res = tools.generate_morning_briefing("Chandigarh")
    assert res.get("ok") is True
    assert "time" in res
    assert "weather" in res
    assert res.get("city") == "Chandigarh"

def test_route_morning_briefing_intent():
    query = "Good morning Vaani, give me my daily briefing for Chandigarh"
    tool_res = tools.route_and_execute_tools(query)
    assert any("morning_briefing" in t for t in tool_res["executed_tools"])
    assert "VAANI EXECUTIVE BRIEFING" in tool_res["evidence_block"]

def test_route_taskflow_create_intent():
    query = "taskflow me task add karo: Prepare OS distributed systems presentation high priority"
    tool_res = tools.route_and_execute_tools(query)
    assert any("taskflow_create" in t for t in tool_res["executed_tools"])
    assert "TASKFLOW ECOSYSTEM ACTION" in tool_res["evidence_block"]
    assert "HIGH" in tool_res["evidence_block"]
