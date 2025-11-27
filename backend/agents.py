# Agent configuration - maps agents to their accessible brands
# Update this file to configure agent access

from typing import Optional, List, Dict

# Brand name mappings - Zoho uses these exact names
# Add variations to catch different spellings
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

# Agents who can view all orders (admins)
ADMIN_AGENTS = ["sammie", "georgia", "matt"]

AGENTS = {
    "kate": {
        "name": "Kate",
        "pin": "1234",
        "commission_rate": 0.15,
        "brands": ["Remember", "My Flame", "Ideas4Seasons", "Räder"]
    },
    "nick": {
        "name": "Nick",
        "pin": "1234",
        "commission_rate": 0.15,
        "brands": ALL_BRANDS
    },
    "dave": {
        "name": "Dave & Chris",
        "pin": "1234",
        "commission_rate": 0.125,
        "brands": ALL_BRANDS
    },
    "gay": {
        "name": "Gay",
        "pin": "1234",
        "commission_rate": 0.125,
        "brands": ["Remember", "Räder", "Ideas4Seasons", "My Flame"]
    },
    "hannah": {
        "name": "Hannah",
        "pin": "1234",
        "commission_rate": 0.125,
        "brands": ["Remember"]
    },
    "steph": {
        "name": "Steph",
        "pin": "1234",
        "commission_rate": 0.125,
        "brands": ["Räder"]
    },
    "georgia": {
        "name": "Georgia",
        "pin": "1234",
        "commission_rate": 0.125,
        "brands": ALL_BRANDS
    },
    "sammie": {
        "name": "Sammie",
        "pin": "1234",
        "commission_rate": 0.125,
        "brands": ALL_BRANDS
    },
    "matt": {
        "name": "Matt",
        "pin": "1234",
        "commission_rate": 0.125,
        "brands": ALL_BRANDS
    },
}


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
    return AGENTS.get(agent_id.lower())


def get_agent_brands(agent_id: str) -> List[str]:
    """Get list of brands an agent can access"""
    agent = get_agent(agent_id)
    return agent["brands"] if agent else []


def verify_agent_pin(agent_id: str, pin: str) -> bool:
    """Verify agent PIN"""
    agent = get_agent(agent_id)
    if not agent:
        return False
    return agent["pin"] == pin


def list_agents() -> List[Dict]:
    """List all agents (without PINs)"""
    return [
        {"id": agent_id, "name": agent["name"]}
        for agent_id, agent in AGENTS.items()
    ]


def is_admin(agent_id: str) -> bool:
    """Check if agent has admin privileges (can view all orders)"""
    return agent_id.lower() in ADMIN_AGENTS
