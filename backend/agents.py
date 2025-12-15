# Agent configuration - uses PostgreSQL for persistence
from typing import Optional, List, Dict
from database import SessionLocal, Agent as AgentModel, init_db

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

# Default agents - used to seed the database if empty
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
    "didi": {
        "name": "Didi",
        "pin": "1234",
        "commission_rate": 0.125,
        "brands": ALL_BRANDS,
        "active": True
    },
}


# ============ Database Seeding ============

def seed_default_agents():
    """Seed database with default agents if empty"""
    db = SessionLocal()
    try:
        # Check if any agents exist
        count = db.query(AgentModel).count()
        if count == 0:
            print("AGENTS: Seeding default agents...")
            for agent_id, data in DEFAULT_AGENTS.items():
                agent = AgentModel(
                    id=agent_id,
                    name=data["name"],
                    pin=data["pin"],
                    commission_rate=data.get("commission_rate", 0.125),
                    brands=data.get("brands", []),
                    active=data.get("active", True)
                )
                db.add(agent)
            db.commit()
            print(f"AGENTS: Seeded {len(DEFAULT_AGENTS)} default agents")
        else:
            print(f"AGENTS: Found {count} existing agents in database")
    except Exception as e:
        print(f"AGENTS: Seeding error: {e}")
        db.rollback()
    finally:
        db.close()


# Seed on import
seed_default_agents()


# ============ Agent Storage (Database) ============

def load_agents() -> Dict:
    """Load all agents from database"""
    db = SessionLocal()
    try:
        agents = db.query(AgentModel).all()
        return {
            agent.id: {
                "name": agent.name,
                "pin": agent.pin,
                "commission_rate": agent.commission_rate,
                "brands": agent.brands or [],
                "active": agent.active
            }
            for agent in agents
        }
    finally:
        db.close()


def save_agent(agent_id: str, data: Dict):
    """Save a single agent to database"""
    db = SessionLocal()
    try:
        agent = db.query(AgentModel).filter(AgentModel.id == agent_id).first()
        if agent:
            # Update existing
            agent.name = data.get("name", agent.name)
            agent.pin = data.get("pin", agent.pin)
            agent.commission_rate = data.get("commission_rate", agent.commission_rate)
            agent.brands = data.get("brands", agent.brands)
            agent.active = data.get("active", agent.active)
        else:
            # Create new
            agent = AgentModel(
                id=agent_id,
                name=data["name"],
                pin=data["pin"],
                commission_rate=data.get("commission_rate", 0.125),
                brands=data.get("brands", []),
                active=data.get("active", True)
            )
            db.add(agent)
        db.commit()
    finally:
        db.close()


def delete_agent_from_db(agent_id: str):
    """Delete an agent from database"""
    db = SessionLocal()
    try:
        agent = db.query(AgentModel).filter(AgentModel.id == agent_id).first()
        if agent:
            db.delete(agent)
            db.commit()
    finally:
        db.close()


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
    
    agent_data = {
        "name": name,
        "pin": pin,
        "commission_rate": commission_rate,
        "brands": brands,
        "active": True
    }
    
    save_agent(agent_id, agent_data)
    return agent_data


def update_agent(agent_id: str, updates: Dict) -> Dict:
    """Update an existing agent"""
    agents = load_agents()
    agent_id = agent_id.lower()
    
    if agent_id not in agents:
        raise ValueError(f"Agent {agent_id} not found")
    
    # Merge updates with existing data
    agent_data = agents[agent_id].copy()
    if "name" in updates:
        agent_data["name"] = updates["name"]
    if "pin" in updates:
        agent_data["pin"] = updates["pin"]
    if "brands" in updates:
        agent_data["brands"] = updates["brands"]
    if "commission_rate" in updates:
        agent_data["commission_rate"] = updates["commission_rate"]
    if "active" in updates:
        agent_data["active"] = updates["active"]
    
    save_agent(agent_id, agent_data)
    return agent_data


def delete_agent(agent_id: str) -> bool:
    """Delete an agent (or deactivate if admin)"""
    agents = load_agents()
    agent_id = agent_id.lower()
    
    if agent_id not in agents:
        raise ValueError(f"Agent {agent_id} not found")
    
    # Don't allow deleting admin accounts, just deactivate
    if agent_id in ADMIN_AGENTS:
        agent_data = agents[agent_id].copy()
        agent_data["active"] = False
        save_agent(agent_id, agent_data)
    else:
        delete_agent_from_db(agent_id)
    
    return True


def get_all_brands() -> List[str]:
    """Get list of all available brands"""
    return ALL_BRANDS.copy()
