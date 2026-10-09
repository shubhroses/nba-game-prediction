-- One row per game.
--
-- RAW_NBA_SCOREBOARD holds one scoreboard response per row, and a game is in
-- every response fetched on its game day. This model unpacks the "games"
-- array of each response and keeps a single snapshot of each game.

with snapshots as (

    select
        game_data,
        -- meta.time looks like '2024-12-12 06:33:12.3312'. The digits after
        -- the last dot repeat the minutes and seconds, so only the first 19
        -- characters are parsed. The feed does not state a time zone.
        try_to_timestamp_ntz(
            left(game_data:meta.time::string, 19),
            'YYYY-MM-DD HH24:MI:SS'
        ) as snapshot_at
    from {{ source('nba', 'raw_nba_scoreboard') }}

),

games as (

    select
        game.value:gameId::string as game_id,
        try_to_date(snapshots.game_data:scoreboard.gameDate::string, 'YYYY-MM-DD') as game_date,
        game.value:gameStatus::integer as game_status_id,
        trim(game.value:gameStatusText::string) as game_status_text,
        game.value:homeTeam.teamId::integer as home_team_id,
        game.value:homeTeam.teamTricode::string as home_team_tricode,
        game.value:homeTeam.score::integer as home_score,
        game.value:awayTeam.teamId::integer as away_team_id,
        game.value:awayTeam.teamTricode::string as away_team_tricode,
        game.value:awayTeam.score::integer as away_score,
        snapshots.snapshot_at
    from snapshots,
        lateral flatten(input => snapshots.game_data:scoreboard.games) as game

),

latest_snapshot as (

    -- gameStatus is 1 before tip-off, 2 while the game is being played and
    -- 3 once the score is final, so the snapshot with the highest status is
    -- the furthest along. It is compared first because snapshot_at has no
    -- time zone and can be null. Among snapshots with the same status the
    -- newest one is kept.
    select *
    from games
    qualify row_number() over (
        partition by game_id
        order by game_status_id desc nulls last, snapshot_at desc nulls last
    ) = 1

)

select
    game_id,
    game_date,
    game_status_id,
    game_status_text,
    game_status_id = 3 as is_final,
    home_team_id,
    home_team_tricode,
    home_score,
    away_team_id,
    away_team_tricode,
    away_score,
    snapshot_at
from latest_snapshot
