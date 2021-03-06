var OpsBufEnum = { APPEND  : 1
                 , PREPEND : 2
                 , REPLACE : 3
                 };

var OpsFetchEnum = { NEXT     :1
                   , PREVIOUS :2
                   , JUMPNEXT :3
                   , JUMPPREV :4
                   , TOEND    :5
                   , TOBEGIN  :6
                   , RELOAD   :7
                   };

if(Object.hasOwnProperty('freeze')) {
    Object.freeze(OpsBufEnum);
    Object.freeze(OpsFetchEnum);
}

String.prototype.visualLength = function()
{
    var ruler = $('#txtlen');
    ruler.html(''+this);
    return ruler.width();
}

function getUniqueTime() {
  var time = new Date().getTime();
  while (time == new Date().getTime());
  return new Date().getTime();
}

var dderlState = {
    session: null,
    adapter: null,
    connection: null,
    connected_user: null,
    service: null,
    ws: null,
    pingTimer: null,
    currentErrorAlert: null,
    dashboards: null,
    currentDashboard: null,
    currentViews: null,
    currentWindows: new Array(),
    saveDashboardCounter: 0,
    connectionSelected: null,
    copyMode: "normal",             // normal, header, json
    operationLogs: ""
}

// generic dderlserver call interface
// TODO: currently the widget and non-widget
//       is determined by the presence of the
//       context variable for widget there is
//       no this['context']
function ajaxCall(_ref,_url,_data,_resphead,_successevt) {
    resetPingTimer();
    var self = _ref;

    // if data is JSON object format to string
    if(_data == null) {
        _data = JSON.stringify({});
    } else {
        try {
            _data = JSON.stringify(_data);
        } catch (ex) {
            console.error(_data + ' is not JSON');
            throw(ex);
        }
    }

    // request url converted to server AJAX map
    _url = 'app/'+_url;

    console.log('[AJAX] TX '+_url);

    var headers = new Object();
    if (dderlState.adapter != null) headers['DDERL-Adapter'] = dderlState.adapter;
    headers['DDERL-Session'] = (dderlState.session != null ? '' + dderlState.session : '');
    if (null != self) {
        if(self.hasOwnProperty('_session')) headers['DDERL-Session'] = self._session;
        if(self.hasOwnProperty('_adapter')) headers['DDERL-Adapter'] = self._adapter;
    }

    $.ajax({
        type: 'POST',
        url: _url,
        data: _data,
        dataType: "JSON",
        contentType: "application/json; charset=utf-8",
        headers: headers,
        context: self,

        success: function(_data, textStatus, request)
        {
            console.log('Request '+_url+' Result '+textStatus);

            if(this && this.hasOwnProperty('_spinCounter') && this._dlg
               && this._dlg.hasClass('ui-dialog-content')) {
                this.removeWheel();
            }

            // Save the session if the request was to log in.
            if(_url == 'app/login') {
                var s = request.getResponseHeader('dderl-session');
                console.log("The session response header dderl-session: ");
                console.log(s);
                dderlState.session = s;
            }

            if(request.status === 204) {
                console.error('204 received for the request ' + _url);
            } else if(!_data)
                throw('null data received for the request '+_url);
            else if(_data.hasOwnProperty(_resphead)) {
                console.log('[AJAX] RX '+_resphead);
                if(this.hasOwnProperty('context') && null == this.context) {
                    if(null === _successevt) {
                        console.log('no success callback for '+_url);
                    } else if($.isFunction(_successevt)) {
                        _successevt(_data[_resphead]);
                    } else {
                        throw('unsupported success event '+_successevt+' for '+_url);
                    }
                } else {
                    if($.isFunction(_successevt)) {
                        _successevt(_data[_resphead]);
                    } else if(this._handlers.hasOwnProperty(_successevt)) {
                        this.element.trigger(_successevt, _data[_resphead]);
                    } else {
                        throw('unsupported success event '+_successevt+' for '+_url);
                    }
                }
            }
            else if(_data.hasOwnProperty('error')) {
                if(_url == 'app/ping' && _data.error) {
                    dderlState.connection = null;
                    dderlState.adapter = null;
                    dderlState.session = null;
                    resetPingTimer();
                }
                if(!dderlState.currentErrorAlert || !dderlState.currentErrorAlert.hasClass('ui-dialog-content')) {
                    dderlState.currentErrorAlert = alert_jq('Error : '+_data.error);
                }
            }
            else {
                console.log(_data);
                throw('resp doesn\'t match the request '+_url);
            }
        },

        error: function (request, textStatus, errorThrown) {
            if(this.hasOwnProperty('_spinCounter')) {
                this.removeWheel();
            }

            if(_url == '/app/ping') {
                _successevt("error");
            } else {
                if(!dderlState.currentErrorAlert || !dderlState.currentErrorAlert.hasClass('ui-dialog-content')) {
                    dderlState.currentErrorAlert = alert_jq('HTTP Error'+
                        (textStatus.length > 0 ? ' '+textStatus:'') +
                        (errorThrown.length > 0 ? ' details '+errorThrown:''));
                }
            }
        }
    });
}

/*** TODO: Move this to dashboard container class dderl.dashboard ***/
function loadDashboard(dashboard) {
    $(".ui-dialog-content").dialog('close');
    dashboard.openViews();
}

function requestDashboards() {
    ajaxCall(null, 'dashboards', null, 'dashboards', function(dashboards) {
        var dashboard, view, viewLayout;
        for(var i = 0; i < dashboards.length; ++i) {
            dashboard = new DDerl.Dashboard(dashboards[i].id, dashboards[i].name, []);
            for(var j = 0; j < dashboards[i].views.length; ++j) {
                view = dashboards[i].views[j];
                viewLayout = view.layout;
                dashboard.addView(
                    new DDerl.DashView(view.id,
                                       viewLayout.x,
                                       viewLayout.y,
                                       viewLayout.width,
                                       viewLayout.height)
                );
            }
            addDashboard(dashboard);
        }
    });
}

//TODO: Check if this can be merged with the windows handler...
function addToCurrentViews(tableView) {
    // Bind to the close event to remove it from the list.
    tableView._dlg.bind("dialogclose", function(event, ui) {
        var viewPos = dderlState.currentViews.indexOf(tableView);
        if(viewPos != -1) {
            dderlState.currentViews.splice(viewPos, 1);
        }
    });
    dderlState.currentViews.push(tableView);
}

function getCurrentViews() {
    var resultViews, id, x, y, w, h;
    resultViews = new Array();
    for(var i = 0; i < dderlState.currentViews.length; ++i) {
        id = dderlState.currentViews[i]._viewId;
        x = dderlState.currentViews[i]._dlg.dialog('widget').position().left;
        y = dderlState.currentViews[i]._dlg.dialog('widget').position().top;
        w = dderlState.currentViews[i]._dlg.dialog('widget').width();
        h = dderlState.currentViews[i]._dlg.dialog('widget').height();
        resultViews.push(new DDerl.DashView(id, x, y, w, h));
    }
    return resultViews;
}

function addDashView(id, x, y, width, height) {
    dderlState.currentDashboard.addView(new DDerl.DashView(id, x, y, width, height));
}

function removeDashView(viewId) {
    dderlState.currentDashboard.removeView(viewId);
}

function findDashboardById(dashboardId) {
    for(var i = 0; i < dderlState.dashboards.length; ++i) {
        if(dderlState.dashboards[i].getId() === dashboardId) {
            return dderlState.dashboards[i];
        }
    }
    return null;
}

function findDashboard(name) {
    for(var i = 0; i < dderlState.dashboards.length; ++i) {
        if(dderlState.dashboards[i].getName() === name) {
            return dderlState.dashboards[i];
        }
    }
    return null;
}

function addDashboard(dashboard) {
    var addedOption, dashboardList;

    dderlState.dashboards.push(dashboard);

    addedOption = document.createElement("option");
    addedOption.value = dashboard.getId();
    addedOption.textContent = dashboard.getName();

    dashboardList = document.getElementById("dashboard-list");
    dashboardList.appendChild(addedOption);
}

function checkTablesNotSaved() {
    var tablesNotSaved, notSavedTitles, message;
    tablesNotSaved = new Array();
    notSavedTitles = "";
    message = "";
    if(dderlState.currentWindows.length === dderlState.currentViews.length) {
        saveDashboard();
    } else {
        notSavedTitles += "<ul>"
        for(var i = 0; i < dderlState.currentWindows.length; ++i) {
            if(!dderlState.currentWindows[i]._viewId) {
                tablesNotSaved.push(dderlState.currentWindows[i]);
                notSavedTitles += "<li>" + dderlState.currentWindows[i].options.title + "</li>";
            }
        }
        notSavedTitles += "</ul>"
        message = "The following tables are not saved as views: <br>" + notSavedTitles;
        $('<div><p><span class="ui-icon ui-icon-alert" style="float: left; margin: 0 7px 20px 0;"></span>'+ message +'</p></div>').appendTo(document.body).dialog({
            resizable: false,
            width: 450,
            height:220,
            modal: true,
            buttons: {
                "Create views": function() {
                    $( this ).dialog( "close" );
                    dderlState.saveDashboardCounter += tablesNotSaved.length;
                    for(var i = 0; i < tablesNotSaved.length; ++i) {
                        tablesNotSaved[i].saveView();
                    }
                },
                "Ignore tables": function() {
                    $( this ).dialog( "close" );
                    saveDashboard();
                },
                Cancel: function() {
                    $( this ).dialog( "close" );
                }
            },
            close : function() {
                $(this).dialog('destroy');
                $(this).remove();
            }
        });
    }
}

function saveDashboardWithCounter() {
    if(dderlState.saveDashboardCounter === 1) {
        saveDashboard();
    } else if(dderlState.saveDashboardCounter > 0) {
        dderlState.saveDashboardCounter -= 1;
    }
}

function saveDashboard() {
    var name, dashboard, dashViews;

    name = document.getElementById("dashboard-list-input").value;
    if(name === "default") {
        alert_jq("Please select a name for the dashboard");
        return;
    }

    dashboard = findDashboard(name);
    dashViews = getCurrentViews();

    if(dashboard === null) {
        dashboard = new DDerl.Dashboard(-1, name, dashViews);
        dashboard.save(function() {
            addDashboard(dashboard);
        });
    } else {
        dashboard.updateViews(dashViews);
        dashboard.save();
    }
}

function createDashboardMenu(container) {
    var mainMenuBar, saveButton, dashboardList, dashboardListObj, defaultOption;

    // Check to only create the elements once.
    if(document.getElementById("dashboard-list")) {
        return;
    }

    // Button creation
    saveButton = document.createElement("input");
    saveButton.type = "button";
    saveButton.id = "dashboard-save";
    saveButton.value = "Save this dash";
    saveButton.onclick = function() {
        checkTablesNotSaved();
    }

    // Default option creation
    defaultOption = document.createElement("option");
    defaultOption.value = "default";
    defaultOption.textContent = "default";

    // Dashboard list creation
    dashboardList = document.createElement("select");
    dashboardList.id = "dashboard-list";
    dashboardList.appendChild(defaultOption);

    // Add elements to the dom
    container.appendChild(dashboardList);
    container.appendChild(saveButton);

    // Convert the select to combobox
    dashboardListObj = $('#dashboard-list').combobox();

    // Add the handler for selection
    dashboardListObj.change(function() {
        var dashId, dashboard;
        dashId = dashboardListObj.val();
        if($('#dashboard-list-input').is(":focus")) {
            $('#dashboard-list-input').blur();
        }
        if(dashId === "default") {
            return;
        } else if(!isNaN(parseInt(dashId)) && isFinite(dashId)) {
            dashboard = findDashboardById(parseInt(dashId));
            if(dashboard) {
                loadDashboard(dashboard);
            }
        }
    });
}

function initDashboards() {
    dderlState.dashboards = new Array();
    dderlState.currentDashboard = new DDerl.Dashboard(-1, "default", []);
    dderlState.currentViews = new Array();
    createDashboardMenu(document.getElementById("dashboard-menu"));
    var userDashboards = requestDashboards();
}
/********** End dashboard functions *********************/


function resetPingTimer() {
    if(dderlState.pingTimer) {
        clearTimeout(dderlState.pingTimer);
    }

    //Stop ping if there is no session.
    if(!dderlState.session) {
        console.log("ping canceled");
        return;
    }

    dderlState.pingTimer = setTimeout(
        function() {
            ajaxCall(null, 'ping', null, 'ping', function(response) {
                console.log("ping " + response);
                if(!response) {
                    alert_jq("Failed to reach the server, the connection might be lost.");
                    clearTimeout(dderlState.pingTimer);
                }
            });
        },
    30000); // Ping time 30 secs.
}

function login_first()
{
    alert_jq("Please log in first!");
}

function show_qry_files(useSystem)
{
    var loggedInUser = $('#btn-change-password').data("logged_in_user");
    if(loggedInUser == undefined || loggedInUser.length == 0) {
        login_first();
        return;
    }
    $('<div>')
    .appendTo(document.body)
    .table({
        autoOpen     : false,
        dderlConn    : dderlState.connection,
        dderlAdapter : dderlState.adapter,
        title        : "All Views"
    })
    .table('loadViews', useSystem);
}

function import_query() {
    if ($("#fileToUpload").length == 0) {
        $('<input type="file" id="fileToUpload" style="position:absolute; top:-100px;" multiple>')
            .appendTo(document.body)
            .change(function() {
                uploadFiles(this.files);
                $(this).attr("value", "");
            });
    }
    $("#fileToUpload").click();
}

function uploadFiles(files)
{
    var xhr = new XMLHttpRequest();
    var fd = new FormData();
    for(var i = 0; i < files.length; ++i) {
        fd.append(files[i].name+' ('+files[i].lastModifiedDate+')', files[i]);
    }
    
    var dlg = $('<div title="Upload">').appendTo(document.body);
    var progressBar = $('<div></div>').appendTo(dlg);
    var progressLbl = $('<div>Starting upload...</div>').appendTo(dlg);

    dlg = dlg.dialog({
        autoOpen: false,
        closeOnEscape: false,
        resizable: false,
        close: function() { $(this).dialog('destroy').remove(); },
        open: function(event, ui) {
            $(this).closest('.ui-dialog').find('.ui-dialog-titlebar-close').hide();
        }
    })
    .dialog("open");

    progressBar.progressbar({
      value: false,
      change: function() {
          progressLbl.text('Uploaded '+progressBar.progressbar('value')+'%');
      },
      complete: function() {
          progressLbl.text('Upload complete. Waiting response...');
      }
    });

    // event listners
    xhr.upload.addEventListener('progress',
        function(e) {
            if(e.lengthComputable) {
                var percentComplete = Math.floor((e.loaded / e.total) * 100);
                progressBar.progressbar('value',percentComplete);
            }
        }, false);
    xhr.addEventListener('progress',
            function(e) {
                if(e.lengthComputable) {
                    var percentComplete = Math.floor((e.loaded / e.total) * 100);
                    progressBar.progressbar('value',percentComplete);
                }
            }, false);
    xhr.addEventListener("load", function(e) {
            var fileObjs = JSON.parse(e.target.responseText).upload;
            dlg.dialog("close");
            for(var idx = 0; idx < fileObjs.length; ++idx) {
                StartSqlEditorWithTitle(fileObjs[idx].fileName, fileObjs[idx].data);
            }
        }, false);
    xhr.addEventListener("error", function(e) {progressLbl.text("upload error!");}, false);
    xhr.addEventListener("abort", function(e) {progressLbl.text("upload cancled!");}, false);

    xhr.open("POST", "app/upload");
    xhr.setRequestHeader('dderl-session', (dderlState.session != null ? '' + dderlState.session : ''));
    xhr.send(fd);
}

function show_more_apps() {
    if($(".extra-app").css('display') === 'none') {
        $(".extra-app").css('display', '');
        $("#more-apps-link").html("-").css('text-decoration', 'none');
    } else {
        $(".extra-app").css('display', 'none');
        $("#more-apps-link").html("+").css('text-decoration', 'none');
    }
}


/* Escape new lines and tabs */
function escapeNewLines(str)
{
    var result = "";
    if(typeof str == 'string' || str instanceof String) {
        for(var i = 0; i < str.length; ++i) {
            if(str.charCodeAt(i) === 9) {
                result += "\\t";
            } else if(str.charCodeAt(i) === 10) {
                result += "\\n";
            } else if(str.charCodeAt(i) !== 13) {
                result += str[i];
            }
        }
    } else {
        result = str;
    }
    return result;
}

function unescapeNewLines(str) {
    str = str.replace(/\\t/gi, "\t");
    str = str.replace(/\\n/gi, "\n");
    return unescape(str);
}

function get_local_apps(table) {
    ajaxCall(null, 'about', null, 'about', function(applications) {
        applications['jQuery'] = {version : $.fn.jquery, dependency : true};
        applications['jQueryUI'] = {version : $.ui.version, dependency : true};
        applications['SlickGrid'] = {version : (new Slick.Grid($('<div>'), [], [], [])).slickGridVersion, dependency : true};
        var apps = '';
        for(app in applications) {
            var version = applications[app].version;
            if(app === "dderl") {
            } else if(applications[app].dependency) {
                apps += '<tr>';
                apps += '<td class="about-dep-name">' + app + '</td>';
                apps += '<td class="about-dep-vsn">' + version + '</td>';
                apps += '</tr>';
            } else {
                apps += '<tr class="extra-app">';
                apps += '<td class="about-dep-name">' + app + '</td>';
                apps += '<td class="about-dep-vsn">' + version + '</td>';
                apps += '</tr>';
            }
        }
        table.html(apps);
        $("#more-apps-link").css('display', '');
        show_more_apps();
    });
}

function get_remote_apps(table) {
    ajaxCall(null, 'remote_apps', {remote_apps : {connection: dderlState.connection}}, 'remote_apps', function(applications) {
        var extra_apps = '';
        for(app in applications) {
            var version = applications[app].version;
            if(app !== "dderl") {
                extra_apps += '<tr class="extra-app">';
                extra_apps += '<td class="about-dep-name">' + app + '</td>';
                extra_apps += '<td class="about-dep-vsn">' + version + '</td>';
                extra_apps += '</tr>';
            }
        }
        table.html(extra_apps);
        $("#more-apps-link").css('display', 'none');
    });
}

function show_about_dlg()
{
    ajaxCall(null, 'about', null, 'about', function(applications) {
        applications['jQuery'] = {version : $.fn.jquery, dependency : true};
        applications['jQueryUI'] = {version : $.ui.version, dependency : true};
        applications['SlickGrid'] = {version : (new Slick.Grid($('<div>'), [], [], [])).slickGridVersion, dependency : true};

        var aboutDlg =
            $('<div id="about-dderl-dlg" title ="About"></div>')
            .appendTo(document.body);

        if(dderlState.connection) {
            aboutDlg.append('<div class="remote-apps"><a id="remote-apps-link" title="Show all remote apps" href="#">show remote</a></div>');
        }

        var table = '<table class="about-deps-table" cellspacing="5" border="0">';
        var extra_apps = '';
        for(app in applications) {
            var version = applications[app].version;
            if(app === "dderl") {
                var description = applications[app].description;
                var p = '<p class="about-title">DDerl</p>';
                p += '<p class="about-vsn">' + version + ' GUI 1.0.9</p>';
                p += '<p class="about-desc">' + description + '</p>';
                p += '<hr>'
                aboutDlg.prepend(p);
            } else if(applications[app].dependency) {
                table += '<tr>';
                table += '<td class="about-dep-name">' + app + '</td>';
                table += '<td class="about-dep-vsn">' + version + '</td>';
                table += '</tr>';
            } else {
                extra_apps += '<tr class="extra-app">';
                extra_apps += '<td class="about-dep-name">' + app + '</td>';
                extra_apps += '<td class="about-dep-vsn">' + version + '</td>';
                extra_apps += '</tr>';
            }
        }
        table += '</table>';
        table = $(table).append(extra_apps);
        aboutDlg.append(table);

        var isLocal = true;
        aboutDlg.find('#remote-apps-link').click(
            function(evt) {
                evt.preventDefault();
                var apps;
                if(isLocal) {
                    isLocal = false;
                    $(this).html("show local");
                    apps = get_remote_apps(table);
                } else {
                    isLocal = true;
                    $(this).html("show remote");
                    apps = get_local_apps(table);
                }
            }
        );

        var divMore = '<div class="about-more"><a id="more-apps-link" title="Show all running apps" href="#" onclick="show_more_apps()">+</a></div>';
        aboutDlg.append(divMore);

        aboutDlg.dialog({
            modal:false,
            width: 230,
            resizable:false,
            open: function() {
                $(this).dialog("widget").appendTo("#main-body");
            },
            close: function() {
                $(this).dialog('destroy');
                $(this).remove();
            }
        }).dialog("widget").draggable("option","containment","#main-body");
        show_more_apps();
    });
}

function alert_jq(string)
{
    var dlgDiv =
        $('<div>')
        .appendTo(document.body)
        .append('<p><span class="ui-icon ui-icon-info" style="float: left; margin: 0 7px 50px 0;"></span>'+string+'</p>')
        .dialog({
            modal:false,
            width: 300,
            height: 300,
            title: "DDerl message",
            open: function() {
                $(this).dialog("widget").appendTo("#main-body");
            },
            close: function() {
                //We have to remove the added child p
                dlgDiv.dialog('destroy');
                dlgDiv.remove();
                dlgDiv.empty();
            }
        });
    dlgDiv.dialog("widget").draggable("option","containment","#main-body");
    return dlgDiv;
}

function confirm_jq(dom, callback)
{
    var content = dom.content;
    if ($.isArray(content))
        content = content.join('<br>');    
    content = '<h1 style="color:red">CAUTION : IRREVERSIBLE ACTION</h1>'+
              '<p style="background-color:black;color:yellow;font-weight:bold;text-align:center;">'+
              'If confirmed can NOT be undone</p>'+
              (content.length > 0
               ? '<div style="position:absolute;top:65px;bottom:5px;overflow-y:scroll;left:5px;right:5px;">'+
                 content+'</div>'
               : '');
    var dlgDiv =
        $('<div>')
        .appendTo(document.body)
        .append(content)
        .dialog({
            modal:false,
            width: 300,
            height: 300,
            title: dom.title,
            open: function() {
                $(this).dialog("widget").appendTo("#main-body");
            },
            close: function() {
                //We have to remove the added child p
                dlgDiv.dialog('destroy');
                dlgDiv.remove();
                dlgDiv.empty();
            },
            buttons: {
                'Ok': function() {
                    $(this).dialog("close");
                    callback();
                },
                'Cancel': function() {
                    $(this).dialog("close");
                }
            }
        });
    dlgDiv.dialog("widget").draggable("option","containment","#main-body");
    return dlgDiv;
}

function prompt_jq(dom, callback)
{
    var content = dom.content;
    if ($.isArray(content))
        content = content.join('<br>');
        content = '<form><fieldset>' +
                  '<label for="prompt_jq_input">' + dom.label + ':</label>' +
                  '<input type="text" id="prompt_jq_input" name="prompt_jq_input" class="text ui-widget-content ui-corner-all" autofocus/>' +
                  (content.length > 0
                   ? '<div style="position:absolute;top:65px;bottom:5px;overflow-y:scroll;left:5px;right:5px;">' +
                     content + '</div>'
                   : '') +
                   '</fieldset></form>';
    var dlgDiv =
        $('<div>')
        .appendTo(document.body)
        .append(content)
        .dialog({
            modal:false,
            width: 300,
            height: 300,
            title: "DDerl parameter input",
            open: function() {
                $(this).dialog("widget").appendTo("#main-body");
            },
            close: function() {
                //We have to remove the added child p
                dlgDiv.dialog('destroy');
                dlgDiv.remove();
                dlgDiv.empty();
            },
            buttons: {
                'Ok': function() {
                    var inputValue = $("#prompt_jq_input").val();
                    if (inputValue) {
                        $(this).dialog("close");
                        callback(inputValue);
                    }
                },
                'Cancel': function() {
                    $(this).dialog("close");
                }
            }
        });
    dlgDiv.dialog("widget").draggable("option","containment","#main-body");
    return dlgDiv;
}

function beep()
{
    var beepStorage = sessionStorage.getItem("beep-sound");
    var beep = $("#beep-sound")[0];

    if (beepStorage) {
        // Reuse existing Data URL from sessionStorage
        beep.setAttribute("src", beepStorage);
        beep.load();
        beep.play();
    } else if (typeof(FileReader) === "function" && beep.currentSrc) { //I.E. 9 doesn't support FileReader
        // Create XHR and FileReader objects
        var xhr = new XMLHttpRequest();
        var fileReader = new FileReader();

        xhr.open("GET", beep.currentSrc, true);
        // Set the responseType to blob
        xhr.responseType = "blob";

        xhr.addEventListener("load", function () {
            if (xhr.status === 200) {
                // onload needed since Google Chrome doesn't support addEventListener for FileReader
                fileReader.onload = function (evt) {
                    // Read out file contents as a Data URL
                    var result = evt.target.result;
                    beep.setAttribute("src", result);
                    // Store Data URL in sessionStorage
                    try {
                        sessionStorage.setItem("beep-sound", result);
                    }
                    catch (e) {
                        console.log("Storage failed: " + e);
                    }
                };
                // Load blob as Data URL
                fileReader.readAsDataURL(xhr.response);
            }
        }, false);
        // Send XHR
        xhr.send();
        beep.load();
        beep.play();
    }
}

$(".grid-header .g-ui-icon").addClass("ui-state-default ui-corner-all");

// In some environment, console is defined but console.log or console.error is missing.
if (window.console && window.console.log && window.console.error) {
    console.log('console log is defined');
} else {
    window['console'] = {log: function(){ }, error: function(){ }};
    console.log('dummy console is created');
}

function change_password(shouldConnect) {
    var loggedInUser;
    if(dderlState.connected_user && dderlState.connection) {
        loggedInUser = dderlState.connected_user;
        change_connect_password(loggedInUser);
    } else {
        loggedInUser = $('#btn-change-password').data("logged_in_user");
        if(loggedInUser == undefined || loggedInUser.length == 0) {
            login_first();
            return;
        }
        change_login_password(loggedInUser, shouldConnect);
    }
}

function smartDialogPosition(container, owner, self, checks)
{
    if(!checks || checks.length === 0) {
        checks = ['right'];
    }
    var dlg = self.dialog("widget");
    var ownerDlg = owner.dialog("widget");
    for(var i = 0; i < checks.length; ++i) {
        var haveSpace = false;
        var newPos = {at: 'left bottom', my : 'left top', of: ownerDlg};
        switch(checks[i]) {
        case 'left':
            haveSpace = ownerDlg.position().left > dlg.width();
            newPos = {at: 'left top', my : 'right top', of: ownerDlg};
            break;
        case 'right':
            haveSpace = container.width() - ownerDlg.position().left - ownerDlg.width() > dlg.width();
            newPos = {at: 'right top', my : 'left top', of: ownerDlg};
            break;
        case 'top':
            haveSpace = ownerDlg.position().top > dlg.height();
            newPos = {at: 'left top', my : 'left bottom', of: ownerDlg};
            break;
        case 'bottom':
            haveSpace = container.height() - ownerDlg.position().top - ownerDlg.height() > dlg.height();
            newPos = {at: 'left bottom', my : 'left top', of: ownerDlg};
            break;
        case 'center':
            haveSpace = false; // Only used as default.
            newPos = {at: 'center top+60', my: 'center top', of: ownerDlg};
        }

        //The last check is the default pos.
        if((i === checks.length - 1) || haveSpace) {
            self.dialog("option", "position", newPos);
            break;
        }
    }
}

function findFreeSpace(self) {
    var currentDlgs = $(".ui-dialog-content");
    var dialogPositions = [];
    for(var i = 0; i < currentDlgs.length; ++i) {
        if($(currentDlgs[i]).dialog('isOpen')) {
            var dlg = $(currentDlgs[i]).dialog("widget");
            var box = {top   : dlg.position().top,
                       left  : dlg.position().left,
                       bottom: dlg.position().top + dlg.height(),
                       right : dlg.position().left + dlg.width()};
            dialogPositions.push(box);
        }
    }
    dialogPositions.sort(function(b1, b2) {return b1.left - b2.left});
    //TODO: Naive implementation, we improve it if it works...
    for(var i = 0; i < $("#main-body").width(); i += 10) {
        for(var j = 0; j < $("#main-body").height(); j += 10) {
        }
    }
    console.log(self.dialog("widget").width() + ", " + self.dialog("widget").height());
    //console.log(dialogPositions);
}

function patch_jquery_ui() {
    // Added this to fix the bug: http://bugs.jqueryui.com/ticket/5559
    // it is currently fixed in jquery-ui 1.10, however we can't upgrade
    // until this bug is also fixed http://bugs.jqueryui.com/ticket/9166
    // it will be probably be fixed on versio 1.11.
    $.ui.plugin.add("resizable", "alsoResize", {
        start: function () {
            var that = $(this).data("ui-resizable"),
            o = that.options,
            _store = function (exp) {
                $(exp).each(function() {
                    var el = $(this);
                    el.data("ui-resizable-alsoresize", {
                        width: parseInt(el.width(), 10), height: parseInt(el.height(), 10),
                        left: parseInt(el.css('left'), 10), top: parseInt(el.css('top'), 10)
                    });
                });
            };

            if (typeof(o.alsoResize) === 'object' && !o.alsoResize.parentNode) {
                if (o.alsoResize.length) { o.alsoResize = o.alsoResize[0]; _store(o.alsoResize); }
                else { $.each(o.alsoResize, function (exp) { _store(exp); }); }
            }else{
                _store(o.alsoResize);
            }
        },

        resize: function (event, ui) {
            var that = $(this).data("ui-resizable"),
            o = that.options,
            os = that.originalSize,
            op = that.originalPosition,
            delta = {
                height: (that.size.height - os.height) || 0, width: (that.size.width - os.width) || 0,
                top: (that.position.top - op.top) || 0, left: (that.position.left - op.left) || 0
            },

            _alsoResize = function (exp, c) {
                $(exp).each(function() {
                    var el = $(this), start = $(this).data("ui-resizable-alsoresize"), style = {},
                    css = c && c.length ? c : el.parents(ui.originalElement[0]).length ? ['width', 'height'] : ['width', 'height', 'top', 'left'];

                    $.each(css, function (i, prop) {
                        var sum = (start[prop]||0) + (delta[prop]||0);
                        if (sum && sum >= 0) {
                            style[prop] = sum || null;
                        }
                    });

                    el.css(style);
                });
            };

            if (typeof(o.alsoResize) === 'object' && !o.alsoResize.nodeType) {
                $.each(o.alsoResize, function (exp, c) { _alsoResize(exp, c); });
            }else{
                _alsoResize(o.alsoResize);
            }
        },

        stop: function () {
            $(this).removeData("resizable-alsoresize");
        }
    });
}

function updateWindowTitle(link, title) {
    var windowsList = document.getElementById("window-finder");
    link.textContent = title;

    // Set the size of the dropdown if the size is bigger than the current one
    // 9 px for each character, with a minimun of 100px
    var titleSize = title.length * 9;
    if(titleSize < 100) {
        titleSize = 100;
    }
    if(windowsList.style.width) {
        var currentRowSize = parseInt(windowsList.style.width, 10);
        if(currentRowSize < titleSize) {
            windowsList.style.width = titleSize + "px";
        }
    } else {
        windowsList.style.width = titleSize + "px";
    }
}

function addWindowFinder(table, title) {
    // Create the elements.
    var windowsList = document.getElementById("window-finder");
    var link = document.createElement("a");
    var li = document.createElement("li");

    // Set the title and the click event.
    link.textContent = title;
    link.onclick = function() {
        if(table && table._dlg && table._dlg.hasClass('ui-dialog-content') && table._dlg.dialog("isOpen") === true) {
            table.moveAllToTop();
        } else {
            // In case we have a invalid entry it is removed.
            windowsList.removeChild(li);
        }
    };

    // Set the size of the dropdown if the size is bigger than the current one
    // 9 px for each character, with a minimun of 100px
    var titleSize = title.length * 9;
    if(titleSize < 100) {
        titleSize = 100;
    }

    if(windowsList.style.width) {
        var currentRowSize = parseInt(windowsList.style.width, 10);
        if(currentRowSize < titleSize) {
            windowsList.style.width = titleSize + "px";
        }
    } else {
        windowsList.style.width = titleSize + "px";
    }

    // Append to the page.
    li.appendChild(link);
    windowsList.appendChild(li);

    // Bind to the close event to remove it from the list.
    table._dlg.bind("dialogclose", function(event, ui) {
        var textChild = "";
        windowsList.removeChild(li);
        // Set the size to the biggest element
        var biggestChild = 100;
        for(var i = 0; i < windowsList.children.length; ++i) {
            sizeChild = windowsList.children[i].textContent.length * 9;
            if(sizeChild > biggestChild) {
                biggestChild = sizeChild;
            }
        }
         windowsList.style.width = biggestChild + "px";
    });

    table._dlg.bind("dialogclose", function(event, ui) {
        var tablePos = dderlState.currentWindows.indexOf(table);
        if(tablePos != -1) {
            dderlState.currentWindows.splice(tablePos, 1);
        }
    });
    // Add it to the global windows array
    dderlState.currentWindows.push(table);
    return link;
}

function groupByColumn(dataView,col,seperator)
{
    var getters = [];
    var funcs = [];
    var ldata = dataView.getItems();
    var level = 0;
    for (var r = 0; r < ldata.length; ++r) {
        var curlength = ldata[r][col].split(seperator).length - 1;
        if (level < curlength) level = curlength;
    }
    for (var r = 0; r < ldata.length; ++r) {
        var curlength = ldata[r][col].split(seperator).length - 1;
        var parts = ldata[r][col].split(seperator);
        for (var li = 0; li < level - curlength; ++li)
            parts.splice(-1, 0, "");
        ldata[r][col+'_grp'] = parts.join('/');
    }

    for (var i = 0; i < level; i++) {          
        funcs[funcs.length] = (function(idx) {   
            return function(row) {
                return row[col+'_grp'].split('/')[idx];
            }
        })(i);
    }    
    for(var i = 0; i < level; ++i) {
        getters[getters.length] = {
            getter: funcs[i],
            formatter: function (g) {
                return "" + g.value + "<span class='slick-group-count'>(" + g.count + ")</span>";
            },
            collapsed: true
        };
    }
    dataView.setGrouping(getters);
}


function md5Arr(data) {
    var dataMd5 = md5(data);
    var dataArr = [];
    for(var i = 0; i < dataMd5.length; i += 2) {
        dataArr.push(parseInt(dataMd5.substring(i,i+2), 16));
    }
    return dataArr;
}

function password_change_dlg(title, loggedInUser, change_pass_fn)
{
    $('<div id="dialog-change-password" title="'+title+'">' +
      '  <table border=0 width=100% height=85% cellpadding=0 cellspacing=0>' +
      '      <tr><td align=right valign=center>User&nbsp;</td>'+
      '         <td valign=center><b>'+loggedInUser+'</b></td></tr>' +
      '      <tr><td align=right valign=center>Old Password&nbsp;</td>'+
      '         <td valign=bottom>' +
      '             <input type="password" id="old_password_login" class="text ui-widget-content ui-corner-all"/>' +
      '         </td></tr>' +
      '      <tr><td align=right valign=center>New Password&nbsp;</td>'+
      '         <td valign=bottom>' +
      '             <input type="password" id="password_change_login" class="text ui-widget-content ui-corner-all"/>' +
      '         </td></tr>' +
      '      <tr><td></td>'+
      '          <td><span id="passstrength"></span></td></tr>' +
      '      <tr><td align=right valign=center>Confirm Password&nbsp;</td>' +
      '         <td valign=bottom>' +
      '             <input type="password" id="conf_password_login" class="text ui-widget-content ui-corner-all"/>' +
      '         </td></tr>' +
      '  </table>' +
      '</div>').appendTo(document.body);

    $('#password_change_login').keyup(function(e) {
        var strongRegex = new RegExp("^(?=.{8,})(?=.*[A-Z])(?=.*[a-z])(?=.*[0-9])(?=.*\\W).*$", "g");
        var mediumRegex = new RegExp("^(?=.{7,})(((?=.*[A-Z])(?=.*[a-z]))|((?=.*[A-Z])(?=.*[0-9]))|((?=.*[a-z])(?=.*[0-9]))).*$", "g");
        var enoughRegex = new RegExp("(?=.{6,}).*", "g");
        if (false == enoughRegex.test($(this).val())) {
            $('#passstrength')
                .removeClass()
                .addClass('password_strength_more')
                .html('More Characters');
        } else if (strongRegex.test($(this).val())) {
            $('#passstrength')
                .removeClass()
                .addClass('password_strength_ok')
                .html('Strong');
        } else if (mediumRegex.test($(this).val())) {
            $('#passstrength')
                .removeClass()
                .addClass('password_strength_alert')
                .html('Medium');
        } else {
            $('#passstrength')
                .removeClass()
                .addClass('password_strength_error')
                .html('Weak');
        }
        return true;
    });
    $('#dialog-change-password').dialog({
        autoOpen: false,
        height: 200,
        width: 300,
        resizable: false,
        modal: false,
        open: function() {
            $(this).dialog("widget").appendTo("#main-body");
        },
        close: function() {
            $("#dialog-change-password").dialog('destroy');
            $("#dialog-change-password").remove();
        },
        buttons: {
            "Change Password": change_pass_fn,
            Cancel: function() {
                $(this).dialog("close");
            }
        }
    })
    .dialog("open")
    .dialog("widget")
    .draggable("option","containment","#main-body");
}
