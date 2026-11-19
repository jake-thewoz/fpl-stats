from season_data import parse_archive_season

SEASON = "2024-25"
ARSENAL_ID = 1
CHELSEA_ID = 7

TEAMS_CSV = """id,name,short_name
1,Arsenal,ARS
7,Chelsea,CHE
"""

FIXTURES_CSV = """id,event,finished,team_h,team_a,team_h_score,team_a_score,team_h_difficulty,team_a_difficulty,kickoff_time,stats
10,1,True,1,7,2,0,3,4,2024-08-17T14:00:00Z,"[{'identifier': 'goals_scored'}]"
20,2,False,7,1,,,4,3,2024-08-24T14:00:00Z,[]
"""

MERGED_HEADER = (
    "name,position,team,xP,element,fixture,opponent_team,was_home,round,minutes,"
    "goals_scored,assists,clean_sheets,goals_conceded,saves,bonus,bps,yellow_cards,"
    "red_cards,own_goals,penalties_saved,penalties_missed,total_points,"
    "expected_goals,value,selected,GW"
)


def _merged_csv(*rows: str) -> str:
    return "\n".join((MERGED_HEADER, *rows)) + "\n"


def _parse(*merged_rows: str):
    return parse_archive_season(
        SEASON,
        merged_gw_csv_text=_merged_csv(*merged_rows),
        teams_csv_text=TEAMS_CSV,
        fixtures_csv_text=FIXTURES_CSV,
    )


SAKA_GW1 = "Bukayo Saka,MID,Arsenal,9.9,5,10,7,True,1,90,1,1,1,0,0,3,40,0,0,0,0,0,12,0.61,100,4000000,1"
PALMER_GW1 = "Cole Palmer,MID,Chelsea,1.0,6,10,1,False,1,90,0,0,0,2,0,0,10,0,0,0,0,0,2,,105,3000000,1"
RAYA_GW1 = "David Raya,GK,Arsenal,5.0,7,10,7,True,1,90,0,0,1,0,3,0,28,0,0,0,0,0,7,0.00,55,2000000,1"
SANCHEZ_GW1 = "Robert Sanchez,GK,Chelsea,1.0,8,10,1,False,1,90,0,0,0,2,4,0,15,0,0,0,0,0,2,0.00,45,500000,1"
ARTETA = "Mikel Arteta,AM,Arsenal,0.0,900,10,7,True,1,0,0,0,0,0,0,0,0,0,0,0,0,0,6,,15,100000,1"


def test_assistant_manager_rows_are_dropped():
    season = _parse(SAKA_GW1, ARTETA)

    assert [row.element for row in season.rows] == [5]
    assert 900 not in season.position_by_player


def test_duplicate_player_fixture_pairs_keep_the_last_one():
    corrected_saka = SAKA_GW1.replace(",12,0.61,", ",13,0.61,")

    season = _parse(SAKA_GW1, PALMER_GW1, corrected_saka)

    saka_rows = [row for row in season.rows if row.element == 5]
    assert len(saka_rows) == 1
    assert saka_rows[0].total_points == 13
    assert len(season.rows) == 2


def test_club_name_maps_to_team_id_per_round():
    season = _parse(SAKA_GW1, PALMER_GW1)

    assert season.team_by_player_round == {(5, 1): ARSENAL_ID, (6, 1): CHELSEA_ID}


def test_positions_map_to_ids():
    season = _parse(RAYA_GW1, SAKA_GW1, SANCHEZ_GW1)

    assert season.position_by_player == {7: 1, 5: 3, 8: 1}


def test_all_four_positions_map():
    defender = SAKA_GW1.replace("Bukayo Saka,MID", "Ben White,DEF").replace(",5,10,", ",11,10,")
    forward = SAKA_GW1.replace("Bukayo Saka,MID", "Kai Havertz,FWD").replace(",5,10,", ",12,10,")

    season = _parse(RAYA_GW1, defender, SAKA_GW1, forward)

    assert season.position_by_player == {7: 1, 11: 2, 5: 3, 12: 4}


def test_values_are_parsed():
    season = _parse(SAKA_GW1, PALMER_GW1)
    saka = next(row for row in season.rows if row.element == 5)
    palmer = next(row for row in season.rows if row.element == 6)

    assert saka.was_home is True
    assert palmer.was_home is False
    assert saka.expected_goals == "0.61"
    assert palmer.expected_goals is None
    assert season.value_by_player_round == {(5, 1): 100, (6, 1): 105}
    assert season.selected_by_player_round == {(5, 1): 4000000, (6, 1): 3000000}
    assert season.name_by_player == {5: "Bukayo Saka", 6: "Cole Palmer"}
    assert season.season == SEASON


def test_fixtures_parse_including_unplayed():
    season = _parse(SAKA_GW1)

    played, unplayed = season.fixtures
    assert (played.id, played.team_h, played.team_a, played.team_h_score) == (10, 1, 7, 2)
    assert played.finished is True
    assert played.team_a_difficulty == 4
    assert unplayed.team_h_score is None
    assert unplayed.finished is False
