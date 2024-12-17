window.lib4x = window.lib4x || {};
window.lib4x.axt = window.lib4x.axt || {};

/*
 * LIB4X Custom Client-Side Validation Plugin
 * Offers 'Validate Item', 'Validate Page' and 'Validate IG Row' events which 
 * can be used in DA's as to define custom validation logic in a 
 * javascript action.
 */
lib4x.axt.validation = (function($)
{
    let instantValidation = false;      // instant show of any client-side validation messages

    // ==page module
    let pageModule = (function() 
    {
        $(apex.gPageContext$).on("apexreadyend", function(jQueryEvent) { 
            // wrap page.validate as to facilitate the 'Validate Page' event
            // where constraints can be defined on the data row level
            let origPageValidate = apex.page.validate;
            apex.page.validate = function(pLocation){
                let valid = origPageValidate(pLocation);
                let eventObj = {};
                // pass current validity
                eventObj.pageItemsValid = valid;
                eventObj.formData = util.page.getFormData();
                eventObj.valid = true; 
                eventObj.validationMessage = "";    
                apex.event.trigger(apex.gPageContext$, 'lib4x_validate_page', eventObj);
                if (!eventObj.valid)
                {
                    valid = false;
                    let errors = [];
                    errors.push({
                        message: eventObj.validationMessage ? eventObj.validationMessage : 'Page Invalid',
                        location: "page"
                    });
                    apex.message.showErrors(errors);
                }                
                return valid;
            };
        });
    })();    

    // ==items module
    let itemsModule = (function() {    
        let origMessageGoToErrorByIndex;
        $(apex.gPageContext$).on("apexreadyend", function(jQueryEvent) {  
            origMessageGoToErrorByIndex = apex.message.goToErrorByIndex;
            // wrap item.getValidity for each item
            // as to facilitate 'Validate Item' event
            for (const [itemId, apexItem] of Object.entries(apex.items)) {
                if ((apexItem.item_type != "HIDDEN") && (apexItem.getValidity))
                {
                    let isColumnItem = util.item.isColumnItem(apexItem);
                    // expand getValidity
                    let origGetValidity = apexItem.getValidity;
                    apexItem.getValidity = function(){
                        // if a html5 custom error was set by lib4x, reset the error  
                        // checking for lib4x_customError as APEX might also have set a 
                        // custom error (like in case of min/max validation for Number fields)
                        if (apexItem.node?.setCustomValidity && apexItem.element.data('lib4x_customError'))
                        {
                            let existingMessage = apexItem.node.validationMessage;
                            if (existingMessage == apexItem.element.data('lib4x_customError'))
                            {
                                apexItem.node.setCustomValidity('');
                            }
                            apexItem.element.data('lib4x_customError', null);
                        }
                        // call the std one and if no validation error
                        // trigger for custom validation
                        let validity = origGetValidity.call(apexItem);
                        let isHTML5validation = (validity instanceof ValidityState);
                        if (validity.valid)
                        {
                            if (!(apexItem.isDisabled && apexItem.isDisabled()))
                            {
                                // https://html.spec.whatwg.org/multipage/input.html#the-readonly-attribute:
                                // If the readonly attribute is specified on an input element, the element is barred from constraint validation.
                                if (!(isHTML5validation && (apexItem.element.is('[readonly]'))))
                                {
                                    let eventObj = initEventObj(itemId, apexItem, isColumnItem);
                                    apex.event.trigger(apexItem.element, 'lib4x_validate_item', eventObj);
                                    if (!eventObj.valid)
                                    {
                                        if (isHTML5validation)
                                        {
                                            // HTML5 validation 
                                            // validity to be set by setCustomValidity API
                                            let validationMessage = eventObj.validationMessage ? eventObj.validationMessage : 'Invalid value';
                                            apexItem.node.setCustomValidity(validationMessage);
                                            apexItem.element.data('lib4x_customError', validationMessage);
                                        }
                                        else
                                        {
                                            // validity is a regular object
                                            validity.customError = true;
                                            validity.valid = false;
                                            // in case of custom error, item.getValidationMessage will take the message from 'data-valid-message' attribute
                                            // overrule with message from eventObj
                                            // like this, there is no need to wrap the item.getValidationMessage method
                                            apexItem.element.attr('data-valid-message', eventObj.validationMessage ? eventObj.validationMessage : 'Invalid value' );
                                        }
                                    }
                                }
                            }
                        }
                        return validity;
                    }
                    if (!isColumnItem && instantValidation)
                    {
                        // keep dirty flag
                        // when user enters a value and then reverts it again, item.isChanged will
                        // be false but the dirty flag will be true
                        apexItem.element.on('change', function(jQueryEvent){  
                            apexItem.element.data('lib4x_dirty', true);
                        });  
                        // define instant validation feedback on focusout                      
                        apexItem.element.on('focusout', function(jQueryEvent){  
                            if (apexItem.element.data('lib4x_dirty'))
                            {
                                validatePageItem(apexItem.id);                                   
                            }
                        });
                    }
                }
            }
        });  
        
        /*
         * validatePageItem
        /* gives validation feedback for the given item
         * makes use of the undocumented itemId argument in message.clearErrors(itemId)
         * in case you don't want, switch off 'instant validation'
         */
        function validatePageItem(itemId)
        {
            let apexItem = apex.item(itemId);
            if ((apexItem.id) && (!(apexItem.isDisabled && apexItem.isDisabled())))
            {
                if (!apexItem.getValidity().valid)
                {
                    let validationMessage = apexItem.getValidationMessage();
                    let existingMessage = $('#' + itemId + '_error').text();
                    if (!existingMessage || existingMessage != validationMessage)
                    {
                        // call clearErrors on the item even if there's no existing message, so the 
                        // error stack gets cleared, preventing any page error(s) shown before (but clicked away
                        // by the user) to pop up again, and preventing the display logic for existing item messages 
                        // so the showErrors below will just only handle the current item
                        apex.message.clearErrors(itemId);
                        let errors = [];
                        errors.push({
                            message: validationMessage,
                            location: "inline",
                            pageItem: itemId
                        });
                        // prevent the focus to be kept on the field and not moving to the next field
                        // as caused by goToErrorByIndex(0)
                        // which would be inconsistent with the behavior in IG
                        apex.message.goToErrorByIndex = function(index) {};
                        apex.message.showErrors(errors);
                        apex.message.goToErrorByIndex = origMessageGoToErrorByIndex;
                    }    
                } 
                else
                {
                    apex.message.clearErrors(itemId);
                }                                          
            }            
        }

        // initialize event object for item validation
        function initEventObj(itemId, apexItem, isColumnItem)
        {
            let eventObj = {};
            eventObj.itemId = itemId;
            eventObj.apexItem = apexItem;
            eventObj.isChanged = apexItem.isChanged();
            eventObj.value = apexItem.getValue();
            eventObj.nativeValue = util.item.getNativeValue(apexItem);
            if (apexItem.item_type == "NUMBER")
            {
                try
                {
                    let dataFormat = apexItem.element.data('format');
                    eventObj.formattedValue = apex.locale.formatNumber(eventObj.nativeValue, dataFormat);
                }
                catch(e) {};
            } 
            if (apexItem.hasDisplayValue())
            {
                eventObj.displayValue = util.item.getDisplayValue(apexItem, eventObj);
            } 
            if (isColumnItem)
            {
                let widget = apexItem.element.closest('.a-IG');
                if (widget.length)
                {
                    let gridView = widget.interactiveGrid('getViews').grid;
                    let model = gridView.model;
                    eventObj.gridView = gridView;
                    eventObj.model = model;
                    eventObj.singleRowMode = gridView.singleRowMode;
                    eventObj.subwidgetInst = util.ig.getCurrentSubwidgetInst(gridView);
                    eventObj.activeRecordId = gridView.getActiveRecordId();
                    eventObj.activeRecord = util.ig.getActiveRecord(gridView);
                    eventObj.activeRecordMetadata = model.getRecordMetadata(eventObj.activeRecordId);
                    let columns = gridView.view$.grid('getColumns');
                    eventObj.property = columns.find(c=>c.elementId == itemId)?.property;
                    eventObj.activeRow = util.ig.getActiveRow(gridView);
                    let origRecord = eventObj.activeRecordMetadata?.original;
                    if (eventObj.property)
                    {
                        eventObj.oldValue = model.getValue(origRecord ? origRecord : eventObj.activeRecord, eventObj.property);
                    }
                }
            }    
            else
            {
                eventObj.formData = util.page.getFormData();
            }                                                                                           
            eventObj.valid = true;
            eventObj.validationMessage = "";  
            return eventObj;                  
        }  
        
        return{
            validatePageItem: validatePageItem
        }        
    })();   

    // ==grids module
    let gridsModule = (function() {
        $(apex.gPageContext$).on("apexreadyend", function(jQueryEvent) {
            // for each IG, validate the active row upon endrecordedit and before save
            $('.a-IG').each(function(){  
                let staticId = $(this).interactiveGrid('option').config.regionStaticId;
                let gridView = $(this).interactiveGrid('getViews').grid;
                let igActions = $(this).interactiveGrid('getActions');
                let saveAction = igActions.lookup("save");
                if (saveAction)
                {
                    let origActionFunction = saveAction.action;
                    saveAction.action = function(jQueryEvent, element) {
                        let subwidgetInst = util.ig.getCurrentSubwidgetInst(gridView); 
                        // make sure the grid (or recordView) is done editing a cell
                        subwidgetInst.finishEditing().done( () => {
                            if (inEditMode(gridView))
                            {
                                // do any needed validation as apex is skipping endrecordedit upon save click
                                validateActiveRow(staticId);
                            }                            
                            origActionFunction(jQueryEvent, element);
                        });
                    };  
                }                                      
                // apexendrecordedit
                $(this).on('apexendrecordedit', function(jQueryEvent){
                    validateActiveRow(staticId);
                });  
            });
        });

        // gives validation feedback for any active row
        // APEX has no specific row validation configuration, but 
        // offers the model.setValidity API, which we utilize here
        // upon firing the 'Validate Row' event
        function validateActiveRow(staticId)
        {
            let gridView = apex.region(staticId).call('getViews').grid;
            let activeRecordId = gridView.getActiveRecordId();
            if (activeRecordId)
            {
                let eventObj = {};
                eventObj.activeRecordId = activeRecordId;
                eventObj.activeRecord = util.ig.getActiveRecord(gridView);
                eventObj.activeRecordMetadata = gridView.model.getRecordMetadata(activeRecordId);                 
                let recordChanged = modelsModule.util.recordInEditMode(eventObj.activeRecordMetadata);
                if (recordChanged)
                {
                    let ig$ = $('#' + staticId);
                    eventObj.staticId = staticId;
                    eventObj.activeRow = util.ig.getActiveRow(gridView);
                    eventObj.columnItemsValid = modelsModule.util.recordFieldsValid(eventObj.activeRecordMetadata);                        
                    eventObj.gridView = gridView;
                    eventObj.model = gridView.model;
                    eventObj.singleRowMode = eventObj.gridView.singleRowMode;
                    eventObj.currentViewId = apex.region(staticId).call('getCurrentViewId');
                    eventObj.subwidgetInst = util.ig.getCurrentSubwidgetInst(gridView);
                    eventObj.valid = true;
                    eventObj.validationMessage = "";
                    apex.event.trigger(ig$, 'lib4x_ig_validate_row', eventObj);
                    if (!eventObj.valid)
                    {
                        gridView.model.setValidity("error", eventObj.activeRecordId, null, eventObj.validationMessage ? eventObj.validationMessage : "Invalid Row");
                    }
                    else 
                    {
                        gridView.model.setValidity("valid", eventObj.activeRecordId);
                    }                          
                } 
            }           
        }   
        
        // check if the IG grid is in edit mode
        function inEditMode(gridView)
        {
            return (gridView.singleRowMode ? gridView.singleRowView$.recordView('inEditMode') : gridView.view$.grid('inEditMode'));
        }  
        
        return{
            validateActiveRow: validateActiveRow
        }
    })();    

    // ==models module
    let modelsModule = (function() {
        let modelUtil = {
            recordInEditMode: function(recMetadata)
            {
                return (recMetadata && (recMetadata.updated || recMetadata.inserted || recMetadata.autoInserted));                
            },
            recordFieldsValid: function(recMetadata)
            {
                let valid = true;
                if (recMetadata)
                {
                    let fields = recMetadata.fields;
                    if (fields)
                    {
                        for (const field in fields) 
                        {
                            if (fields[field].error)
                            {
                                valid = false;
                                break;
                            }
                        }
                    }
                }
                return valid;                
            }
        };

        return{
            util: modelUtil
        }
    })();    
    
    // ==util module
    let util = {    
        item:
        {
            isColumnItem: function(apexItem)
            {
                return (apexItem.element.closest('.a-GV-columnItem').length > 0);
            },
            getNativeValue: function(apexItem)
            {
                let result = null;
                if (apexItem.item_type == "NUMBER")
                {
                    result = apexItem.getNativeValue();
                    if (isNaN(result))
                    {
                        result = null;
                    }
                }
                else if ((apexItem.item_type == "QE") || (apexItem.item_type == "WE") || (apexItem.item_type == "ZE") || (apexItem.item_type == "DATE_PICKER") || (apexItem.node?.nodeName == 'A-DATE-PICKER'))
                {
                    try
                    {
                        result = apex.date.parse(apexItem.getValue(), this.getDateFormat(apexItem));
                    }
                    catch(e) {};                
                }
                else
                {
                    result = apexItem.getValue();
                }
                return result;
            },
            getDisplayValue: function(apexItem, eventObj)
            {
                let displayValue = apexItem.displayValueFor(eventObj.value);
                if (displayValue && apexItem.item_type == "SINGLE_CHECKBOX")    // by default, it gives a span element as string 
                {
                    let checkedLabel = apex.lang.getMessage( "APEX.ITEM_TYPE.CHECKBOX.CHECKED");
                    let uncheckedLabel = apex.lang.getMessage( "APEX.ITEM_TYPE.CHECKBOX.UNCHECKED")
                    if (displayValue.indexOf(uncheckedLabel) > -1)
                    {
                        displayValue = uncheckedLabel;
                    }
                    else if (displayValue.indexOf(checkedLabel) > -1)
                    {
                        displayValue = checkedLabel;
                    }
                    else
                    {
                        displayValue = "";
                    }
                } 
                return displayValue;               
            },
            getDateFormat: function(apexItem)
            {
                let dateFormat = apexItem.element.attr('format');  // regular attribute!
                if (!dateFormat)
                {
                    dateFormat = apex.locale.getDateFormat();
                } 
                return dateFormat;               
            },            
        },
        ig:
        {
            getGridInst: function(gridView)
            {
                return gridView.view$.grid("instance");
            },
            getRecordViewInst: function(gridView)
            {
                return gridView.singleRowView$.recordView("instance");
            },
            getCurrentSubwidgetInst: function(gridView)
            {
                let subwidgetInst = null;
                if (gridView.singleRowMode)
                {
                    subwidgetInst = this.getRecordViewInst(gridView);
                }
                else
                {
                    subwidgetInst = this.getGridInst(gridView);
                }
                return subwidgetInst;
            }, 
            // getActiveRecord: record data from model
            getActiveRecord: function(gridView)
            {
                return (gridView.singleRowMode ? gridView.singleRowView$.recordView('getActiveRecord') : gridView.view$.grid('getActiveRecord'));
            },    
            // getActiveRow: data from column items
            getActiveRow: function(gridView)
            {
                let activeRow = null;
                // check if there is a row active by checking the activeRecordId
                let activeRecordId = gridView.getActiveRecordId();
                if (activeRecordId)
                {
                    activeRow = {};
                    let columns = gridView.view$.grid('getColumns');
                    for (column of columns)
                    {
                        if (column.elementId)
                        {
                            activeRow[column.elementId] = util.item.getNativeValue(apex.item(column.elementId));
                        }
                    }
                }
                return activeRow;
            }
        },
        page:
        {
            getFormData: function()
            {
                let formData = {};
                for (const [itemId, apexItem] of Object.entries(apex.items)) 
                {
                    let isColumnItem = util.item.isColumnItem(apexItem);    
                    if (!isColumnItem)
                    {
                        formData[itemId] = util.item.getNativeValue(apexItem);
                    }
                }
                return formData;
            }
        }
    }    
    
    // called by the DA as to init the plugin
    let init = function()
    {
        let daThis = this;
        instantValidation = (daThis.action.attribute01 == 'Y');
    }

    return{
        _init: init,
        validatePageItem: itemsModule.validatePageItem,
        ig: {
            validateActiveRow: gridsModule.validateActiveRow
        }
    }    
})(apex.jQuery);      
