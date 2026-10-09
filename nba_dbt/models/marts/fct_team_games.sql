-- One row per team per game: every game from stg_nba__games appears twice,
-- once from the home team's side and once from the away team's side.

with games as (

    select * from {{ ref('stg_nba__games') }}

),

team_games as (

    select
        game_id,
        game_date,
        game_status_id,
        game_status_text,
        is_final,
        'home' as home_away,
        home_team_id as team_id,
        home_team_tricode as team_tricode,
        away_team_id as opponent_team_id,
        away_team_tricode as opponent_team_tricode,
        home_score as points_for,
        away_score as points_against
    from games

    union all

    select
        game_id,
        game_date,
        game_status_id,
        game_status_text,
        is_final,
        'away' as home_away,
        away_team_id as team_id,
        away_team_tricode as team_tricode,
        home_team_id as opponent_team_id,
        home_team_tricode as opponent_team_tricode,
        away_score as points_for,
        home_score as points_against
    from games

)

select
    game_id || '-' || team_id::varchar as team_game_id,
    game_id,
    game_date,
    team_id,
    team_tricode,
    opponent_team_id,
    opponent_team_tricode,
    home_away,
    game_status_id,
    game_status_text,
    is_final,
    points_for,
    points_against,
    -- Only a finished game has a winner. NBA games cannot end level.
    case when is_final then points_for > points_against end as won
from team_games
