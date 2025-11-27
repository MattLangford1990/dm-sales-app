# Agent configuration - maps agents to their accessible brands
# Agents are now stored in agents_data.json for persistence

from typing import Optional, List, Dict
import os
import json

# Brand name mappings - Zoho uses these exact names
BRAND_VARIATIONS = {
    "Remember": ["Remember"],
    "Räder": ["Räder", "Rader", "Rader GmbH"],
    "My Flame": ["My Flame", "My Flame Lifestyle", "MyFlame"],
    "Ideas4Seasons": ["Ideas4Seasons", "Ideas 4 Seasons", "Ideas4 Seasons", "i4s"],
    "Relaxound": ["Relaxound"],
    "Elvang Denmark": ["Elvang Denmark", "Elvang"],
    "Paper Products Design": ["Paper Products Design", "ppd PAPERPRODUCTS DESIGN GmbH", "ppd", "PAPERPRODUCTS DESIGN"],
    "GEFU": ["GEFU", "Gefu"],
}

ALL_BRANDS = ["Remember", "Räder", "Relaxound", "My Flame", "Elvang Denmark", "Paper Products Design", "Ideas4Seasons", "GEFU"]

# Agents who can view all orders and access admin panel
ADMIN_AGENTS = ["sammie", "georgia", "matt"]

# File to store agents
AGENTS_FILE = os.path.join(os.path.dirname(__file__), "agents_data.json")

# Default agents (used if no file exists)
DEFAULT_AGENTS = {
    "kate.ellis": {
        "name": "Kate Ellis",
        "pin": "1234",
        "commission_rate": 0.15,
        "brands": ["Remember", "My Flame", "Ideas4Seasons", "Räder"],
        "active": True
    },
    "nick.barr": {
        "name": "Nick Barr",
        "pin": "1234",
        "commission_rate": 0.15,
        "brands": ALL_BRANDS,
        "active": True
    },
    "dc.roberts": {
        "name": "DC Roberts",
        "pin": "1234",
        "commission_rate": 0.125,
        "brands": ALL_BRANDS,
        "active": True
    },
    "gay.croker": {
        "name": "Gay Croker",
        "pin": "1234",
        "commission_rate": 0.125,
        "brands": ["Remember", "Räder", "Ideas4Seasons", "My Flame"],
        "active": True
    },
    "hannah.neale": {
        "name": "Hannah Neale",
        "pin": "1234",
        "commission_rate": 0.125,
        "brands": ["Remember"],
        "active": True
    },
    "steph.gillard": {
        "name": "Steph Gillard",
        "pin": "1234",
        "commission_rate": 0.125,
        "brands": ["Räder"],
        "active": True
    },
    "georgia": {
        "name": "Georgia",
        "pin": "1234",
        "commission_rate": 0.125,
        "brands": ALL_BRANDS,
        "active": True
    },
    "sammie": {
        "name": "Sammie",
        "pin": "1234",
        "commission_rate": 0.125,
        "brands": ALL_BRANDS,
        "active": True
    },
    "matt": {
        "name": "Matt",
        "pin": "1234",
        "commission_rate": 0.125,
        "brands": ALL_BRANDS,
        "active": True
    },
}

# ============ Agent Storage ============

def load_agents() -> Dict:
    """Load agents from file, or return defaults"""
    if os.path.exists(AGENTS_FILE):
        try:
            with open(AGENTS_FILE, 'r') as f:
                return json.load(f)
        except:
            pass
    return DEFAULT_AGENTS.copy()

def save_agents(agents: Dict):
    """Save agents to file"""
    with open(AGENTS_FILE, 'w') as f:
        json.dump(agents, f, indent=2)

def get_agents() -> Dict:
    """Get all agents"""
    return load_agents()

# ============ Agent Lookups ============

def get_brand_patterns(brand_name: str) -> List[str]:
    """Get all variations/patterns for a brand name"""
    return BRAND_VARIATIONS.get(brand_name, [brand_name])

def get_all_brand_patterns(brand_names: List[str]) -> List[str]:
    """Get all variations for a list of brands"""
    patterns = []
    for brand in brand_names:
        patterns.extend(get_brand_patterns(brand))
    return patterns

def get_agent(agent_id: str) -> Optional[Dict]:
    """Get agent configuration by ID"""
    agents = load_agents()
    return agents.get(agent_id.lower())

def get_agent_brands(agent_id: str) -> List[str]:
    """Get list of brands an agent can access"""
    agent = get_agent(agent_id)
    return agent["brands"] if agent else []

def verify_agent_pin(agent_id: str, pin: str) -> bool:
    """Verify agent PIN"""
    agent = get_agent(agent_id)
    if not agent:
        return False
    # Check if agent is active
    if not agent.get("active", True):
        return False
    return agent["pin"] == pin

def list_agents() -> List[Dict]:
    """List all agents (without PINs)"""
    agents = load_agents()
    return [
        {"id": agent_id, "name": agent["name"]}
        for agent_id, agent in agents.items()
        if agent.get("active", True)
    ]

def is_admin(agent_id: str) -> bool:
    """Check if agent has admin privileges"""
    return agent_id.lower() in ADMIN_AGENTS

# ============ Admin Functions ============

def list_all_agents_admin() -> List[Dict]:
    """List all agents with full details (for admin panel)"""
    agents = load_agents()
    return [
        {
            "id": agent_id,
            "name": agent["name"],
            "commission_rate": agent.get("commission_rate", 0),
            "brands": agent.get("brands", []),
            "active": agent.get("active", True),
            "is_admin": agent_id in ADMIN_AGENTS
        }
        for agent_id, agent in agents.items()
    ]

def create_agent(agent_id: str, name: str, pin: str, brands: List[str], commission_rate: float = 0.125) -> Dict:
    """Create a new agent"""
    agents = load_agents()
    agent_id = agent_id.lower()
    
    if agent_id in agents:
        raise ValueError(f"Agent {agent_id} already exists")
    
    agents[agent_id] = {
        "name": name,
        "pin": pin,
        "commission_rate": commission_rate,
        "brands": brands,
        "active": True
    }
    
    save_agents(agents)
    return agents[agent_id]

def update_agent(agent_id: str, updates: Dict) -> Dict:
    """Update an existing agent"""
    agents = load_agents()
    agent_id = agent_id.lower()
    
    if agent_id not in agents:
        raise ValueError(f"Agent {agent_id} not found")
    
    # Update allowed fields
    if "name" in updates:
        agents[agent_id]["name"] = updates["name"]
    if "pin" in updates:
        agents[agent_id]["pin"] = updates["pin"]
    if "brands" in updates:
        agents[agent_id]["brands"] = updates["brands"]
    if "commission_rate" in updates:
        agents[agent_id]["commission_rate"] = updates["commission_rate"]
    if "active" in updates:
        agents[agent_id]["active"] = updates["active"]
    
    save_agents(agents)
    return agents[agent_id]

def delete_agent(agent_id: str) -> bool:
    """Delete an agent (or deactivate if admin)"""
    agents = load_agents()
    agent_id = agent_id.lower()
    
    if agent_id not in agents:
        raise ValueError(f"Agent {agent_id} not found")
    
    # Don't allow deleting admin accounts, just deactivate
    if agent_id in ADMIN_AGENTS:
        agents[agent_id]["active"] = False
    else:
        del agents[agent_id]
    
    save_agents(agents)
    return True

def get_all_brands() -> List[str]:
    """Get list of all available brands"""
    return ALL_BRANDS.copy()
