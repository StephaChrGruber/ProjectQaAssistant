from ..models.base_mongo_models import Connector

async def load_connectors(project_id: str) -> list[Connector]:
    return await Connector.find(
        Connector.projectId == project_id,
        Connector.isEnabled == True,
        ).to_list()
