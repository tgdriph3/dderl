-module(dderl_session_sup).
-behaviour(supervisor).

-include("dderl.hrl").

%% API
-export([start_link/0
        ,start_session/3
        ,close_session/1
        ,list_sessions/0]).

%% Supervisor callbacks
-export([init/1]).

%% Helper macro for declaring children of supervisor
-define(CHILD(I), {I, {I, start_link, []}, temporary, 5000, worker, [I]}).

%% ===================================================================
%% API functions
%% ===================================================================
-spec start_link() -> ignore | {error, term()} | {ok, pid()}.
start_link() ->
    ?Info("~p starting...~n", [?MODULE]),
    case supervisor:start_link({local, ?MODULE}, ?MODULE, []) of
        {ok,_} = Success ->
            ?Info("~p started!~n", [?MODULE]),
            Success;
        Error ->
            ?Error("~p failed to start ~p~n", [?MODULE, Error]),
            Error
    end.

-spec start_session(reference(), binary(), fun(() -> map())) -> {error, term()} | {ok, pid()}.
start_session(Ref, RandBytes, ConnInfoFun) when is_function(ConnInfoFun, 0) ->
	supervisor:start_child(?MODULE, [Ref, RandBytes, ConnInfoFun]).

-spec close_session(pid()) -> ok | {error, not_found | simple_one_for_one}.
close_session(SessionPid) ->
    supervisor:terminate_child(?MODULE, SessionPid).

-spec list_sessions() -> list().
list_sessions() ->
    %%TODO: We should return more information, maybe ip and username.
    supervisor:which_children(?MODULE).

%% ===================================================================
%% Supervisor callbacks
%% ===================================================================

init([]) ->
	SupFlags = {simple_one_for_one, 5, 10},
    {ok, {SupFlags, [?CHILD(dderl_session)]}}.
