import json
import os

from livekit import api


def mint_token(*, room: str, identity: str, agent_name: str, metadata: dict) -> str:
    return (
        api.AccessToken(os.environ["LIVEKIT_API_KEY"], os.environ["LIVEKIT_API_SECRET"])
        .with_identity(identity)
        .with_grants(api.VideoGrants(room_join=True, room=room))
        .with_room_config(api.RoomConfiguration(
            agents=[api.RoomAgentDispatch(agent_name=agent_name, metadata=json.dumps(metadata))],
            sync_streams=True,
        ))
        .to_jwt()
    )
